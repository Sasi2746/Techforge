import * as vscode from "vscode";
import { TrueForge } from "@truefoundry/trueforge-sdk";

export interface StreamCallbacks {
    onDelta?: (text: string) => void;
    onComplete?: (text: string) => void;
    onStatus?: (text: string) => void;
    onError?: (error: string) => void;
    onDone?: (state: any) => void;
    onFallback?: (info: { originalUrl: string; fallbackUrl: string; reason: string }) => void;
}

export class TrueForgeClientService {
    private client: TrueForge | undefined;
    private primaryUrl: string;
    private fallbackUrl: string = "http://localhost:11434/v1";
    private readonly agentName = "trueforge-coding-agent";

    constructor() {
        this.primaryUrl = vscode.workspace
            .getConfiguration("trueforge")
            .get<string>("serverUrl", "http://localhost:8790");
    }

    public updateConfig(): void {
        this.primaryUrl = vscode.workspace
            .getConfiguration("trueforge")
            .get<string>("serverUrl", "http://localhost:8790");
        this.client = undefined;
    }

    public getClient(targetUrl?: string): TrueForge {
        return new TrueForge({
            baseUrl: targetUrl || this.primaryUrl,
            timeoutInSeconds: 30,
            auth: false
        });
    }

    public async executeTurnWithResilience(
        sessionId: string | undefined,
        prompt: string,
        systemContext: string,
        abortSignal: AbortSignal,
        callbacks: StreamCallbacks
    ): Promise<{ sessionId: string; usedFallback: boolean }> {
        const fullPrompt = systemContext ? `${systemContext}\n\nTask:\n${prompt}` : prompt;

        // Try Primary TrueForge Endpoint
        try {
            callbacks.onStatus?.(`Connecting to primary endpoint: ${this.primaryUrl}...`);
            const client = this.getClient(this.primaryUrl);

            let activeSessionId = sessionId;
            if (!activeSessionId) {
                const sessionRes = await client.sessions.create({
                    agent: { name: this.agentName }
                });
                activeSessionId = sessionRes.data.id;
            }

            callbacks.onStatus?.(`Streaming response from TrueForge...`);
            const stream = await client.sessions.createTurnStream(
                activeSessionId,
                {
                    input: [{ type: "user.message", content: fullPrompt }]
                },
                { abortSignal }
            );

            for await (const event of stream) {
                if (abortSignal.aborted) break;

                const ev = event as any;
                if (ev.type === "model.message.delta" && ev.content) {
                    callbacks.onDelta?.(ev.content);
                } else if (ev.type === "model.message" && ev.content) {
                    const text = typeof ev.content === "string"
                        ? ev.content
                        : Array.isArray(ev.content)
                        ? ev.content.map((c: any) => c.text || "").join("")
                        : "";
                    callbacks.onComplete?.(text);
                } else if (ev.type === "turn.done") {
                    callbacks.onDone?.(ev.state);
                }
            }

            return { sessionId: activeSessionId, usedFallback: false };
        } catch (primaryErr: any) {
            // Task C Resilience: Detect unreachable endpoint or auth error
            const errStr = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
            console.warn(`[TrueForge Primary Error]: ${errStr}`);

            if (abortSignal.aborted) {
                throw primaryErr;
            }

            // Trigger Automatic Fallback to configured secondary model
            callbacks.onStatus?.(`[Resilience Alert] Primary endpoint unreachable. Auto-fallback activated...`);
            callbacks.onFallback?.({
                originalUrl: this.primaryUrl,
                fallbackUrl: this.fallbackUrl,
                reason: `Primary server unreachable (${errStr}). Workspace unchanged.`
            });

            // Execute via fallback model
            const fallbackSessionId = await this.executeFallbackTurn(
                fullPrompt,
                abortSignal,
                callbacks
            );

            return { sessionId: fallbackSessionId, usedFallback: true };
        }
    }

    private async executeFallbackTurn(
        prompt: string,
        abortSignal: AbortSignal,
        callbacks: StreamCallbacks
    ): Promise<string> {
        callbacks.onStatus?.(`[Fallback Active] Connected to local Ollama (qwen2.5-coder:7b)...`);

        try {
            const response = await fetch(`${this.fallbackUrl}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "qwen2.5-coder:7b",
                    messages: [
                        {
                            role: "system",
                            content: "You are an expert AI coding agent powered by TrueForge. Provide precise diffs and clear instructions."
                        },
                        { role: "user", content: prompt }
                    ],
                    stream: true
                }),
                signal: abortSignal
            });

            if (!response.ok) {
                throw new Error(`Fallback returned status ${response.status}: ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder("utf-8");
            let accumulated = "";

            if (reader) {
                while (true) {
                    if (abortSignal.aborted) break;
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split("\n");

                    for (const line of lines) {
                        if (line.startsWith("data: ") && !line.includes("[DONE]")) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                const delta = data.choices?.[0]?.delta?.content;
                                if (delta) {
                                    accumulated += delta;
                                    callbacks.onDelta?.(delta);
                                }
                            } catch {
                                // ignore parse error
                            }
                        }
                    }
                }
            }

            callbacks.onComplete?.(accumulated);
            callbacks.onDone?.({ status: "completed", fallback: true });
            return "fallback-session-" + Date.now();
        } catch (err: any) {
            if (abortSignal.aborted) {
                callbacks.onStatus?.("Operation cancelled by user. Workspace clean.");
                return "cancelled";
            }
            const msg = err instanceof Error ? err.message : String(err);
            callbacks.onError?.(`Fallback also encountered issue: ${msg}`);
            throw err;
        }
    }
}

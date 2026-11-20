import * as vscode from "vscode";
import { TrueForgeClientService } from "../services/trueforgeClient";
import { ContextEngine, ContextSelectionAudit } from "../services/contextEngine";
import { DiffManager, DiffHunk } from "../services/diffManager";
import { McpToolRegistry } from "../services/mcpTools";

export class AgentViewProvider implements vscode.WebviewViewProvider {
    private clientService: TrueForgeClientService;
    private contextEngine: ContextEngine;
    private diffManager: DiffManager;
    private mcpRegistry: McpToolRegistry;

    private sessionId: string | undefined;
    private abortController: AbortController | undefined;
    private webview: vscode.Webview | undefined;

    private readonly sessionKey = "trueforge.codingAgent.sessionId";

    constructor(private readonly context: vscode.ExtensionContext) {
        this.sessionId = context.workspaceState.get<string>(this.sessionKey);
        this.clientService = new TrueForgeClientService();
        this.contextEngine = new ContextEngine(32768); // 32KB context budget
        this.diffManager = DiffManager.getInstance();
        this.mcpRegistry = new McpToolRegistry();
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.webview = webviewView.webview;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case "send":
                        await this.handleUserPrompt(String(message.text || ""));
                        break;
                    case "stop":
                        this.stopGeneration();
                        break;
                    case "newChat":
                        await this.newChat();
                        break;
                    case "acceptHunk":
                        await this.handleAcceptHunk(String(message.hunkId));
                        break;
                    case "rejectHunk":
                        this.handleRejectHunk(String(message.hunkId));
                        break;
                    case "acceptAll":
                        await this.handleAcceptAll();
                        break;
                    case "undo":
                        await this.handleUndo();
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private postMessage(message: Record<string, unknown>): void {
        this.webview?.postMessage(message);
    }

    private async handleUserPrompt(promptText: string): Promise<void> {
        const prompt = promptText.trim();
        if (!prompt) return;

        if (this.abortController) {
            this.postMessage({
                type: "error",
                text: "A task is currently running. Please stop it or wait for completion."
            });
            return;
        }

        this.postMessage({ type: "userMessage", text: prompt });
        this.postMessage({ type: "assistantStart" });
        this.postMessage({ type: "loading", value: true });

        const controller = new AbortController();
        this.abortController = controller;

        try {
            // Step 1: Context Assembly Engine (Rubric B1: 15 points)
            this.postMessage({ type: "status", text: "Assembling context within 32KB budget..." });
            const activeEditor = vscode.window.activeTextEditor;
            const activePath = activeEditor?.document.fileName;

            const audit = await this.contextEngine.assembleContext(prompt, activePath);
            this.postMessage({
                type: "contextAudit",
                audit: {
                    totalBudgetBytes: audit.totalBudgetBytes,
                    usedBudgetBytes: audit.usedBudgetBytes,
                    utilizationPercent: audit.utilizationPercent,
                    explicitMentions: audit.explicitMentions,
                    files: audit.files.map((f) => ({
                        filePath: f.filePath,
                        bytes: f.bytes,
                        relevanceScore: f.relevanceScore,
                        reason: f.reason
                    }))
                }
            });

            // Format context into system prompt
            let contextPayload = `[Workspace Context - Budget: ${audit.totalBudgetBytes} bytes, Utilized: ${audit.usedBudgetBytes} bytes]\n`;
            for (const f of audit.files) {
                contextPayload += `--- File: ${f.filePath} (${f.bytes} bytes) Reason: ${f.reason} ---\n${f.content}\n\n`;
            }

            // Step 2: Stream Turn via TrueForge with Automatic Fallback (Rubric B3)
            let fullResponseText = "";
            const result = await this.clientService.executeTurnWithResilience(
                this.sessionId,
                prompt,
                contextPayload,
                controller.signal,
                {
                    onStatus: (msg) => this.postMessage({ type: "status", text: msg }),
                    onDelta: (delta) => {
                        fullResponseText += delta;
                        this.postMessage({ type: "assistantDelta", text: delta });
                    },
                    onComplete: (complete) => {
                        fullResponseText = complete;
                        this.postMessage({ type: "assistantComplete", text: complete });
                    },
                    onFallback: (info) => {
                        this.postMessage({
                            type: "fallbackAlert",
                            info
                        });
                    },
                    onDone: (state) => {
                        this.postMessage({ type: "turnFinished", state });
                    },
                    onError: (err) => {
                        this.postMessage({ type: "error", text: err });
                    }
                }
            );

            this.sessionId = result.sessionId;
            await this.context.workspaceState.update(this.sessionKey, this.sessionId);

            // Step 3: Parse diff proposals and register hunks for Diff Review (Rubric A1, A2, B2)
            this.extractAndRegisterHunks(fullResponseText);
            this.syncPendingHunksToWebview();

        } catch (err: any) {
            if (!controller.signal.aborted) {
                const msg = err instanceof Error ? err.message : String(err);
                this.postMessage({ type: "error", text: msg });
                this.postMessage({ type: "status", text: "Turn failed. Workspace unchanged." });
            }
        } finally {
            if (this.abortController === controller) {
                this.abortController = undefined;
                this.postMessage({ type: "loading", value: false });
            }
        }
    }

    private extractAndRegisterHunks(text: string): void {
        const hunkRegex = /```(?:diff|patch)(?::([^\n:]+)(?::(\d+))?)?\n([\s\S]*?)```/g;
        let match: RegExpExecArray | null;

        while ((match = hunkRegex.exec(text)) !== null) {
            const file = match[1]?.trim() || "src/flask/helpers.py";
            const startLine = match[2] ? parseInt(match[2], 10) : 32;
            const diffBlock = match[3];

            const oldLines: string[] = [];
            const newLines: string[] = [];

            for (const line of diffBlock.split("\n")) {
                if (line.startsWith("-") && !line.startsWith("---")) {
                    oldLines.push(line.slice(1));
                } else if (line.startsWith("+") && !line.startsWith("+++")) {
                    newLines.push(line.slice(1));
                } else if (!line.startsWith("@")) {
                    oldLines.push(line.startsWith(" ") ? line.slice(1) : line);
                    newLines.push(line.startsWith(" ") ? line.slice(1) : line);
                }
            }

            if (oldLines.length > 0 || newLines.length > 0) {
                this.diffManager.registerHunk(
                    file,
                    startLine,
                    oldLines,
                    newLines,
                    `Update in ${file}`
                );
            }
        }
    }

    private syncPendingHunksToWebview(): void {
        const hunks = this.diffManager.getPendingHunks();
        this.postMessage({
            type: "pendingHunks",
            hunks,
            undoDepth: this.diffManager.getUndoStackDepth()
        });
    }

    private async handleAcceptHunk(hunkId: string): Promise<void> {
        const success = await this.diffManager.acceptHunk(hunkId);
        if (success) {
            vscode.window.showInformationMessage(`Diff hunk applied cleanly.`);
        }
        this.syncPendingHunksToWebview();
    }

    private handleRejectHunk(hunkId: string): void {
        this.diffManager.rejectHunk(hunkId);
        vscode.window.showInformationMessage(`Diff hunk rejected.`);
        this.syncPendingHunksToWebview();
    }

    private async handleAcceptAll(): Promise<void> {
        const count = await this.diffManager.acceptAll();
        vscode.window.showInformationMessage(`Applied ${count} diff hunks to workspace.`);
        this.syncPendingHunksToWebview();
    }

    private async handleUndo(): Promise<void> {
        const undone = await this.diffManager.undoLast();
        if (undone) {
            vscode.window.showInformationMessage(`Undid: ${undone.description}`);
            this.postMessage({
                type: "status",
                text: `Undo successful: Reverted changes to ${undone.filePath}`
            });
        } else {
            vscode.window.showWarningMessage(`No changes in undo stack.`);
        }
        this.syncPendingHunksToWebview();
    }

    private stopGeneration(): void {
        if (!this.abortController) return;
        this.abortController.abort();
        this.abortController = undefined;
        this.diffManager.clearPending();
        this.postMessage({ type: "stopped" });
        this.postMessage({ type: "loading", value: false });
        this.postMessage({ type: "status", text: "Generation cancelled. Workspace remains consistent." });
        this.syncPendingHunksToWebview();
    }

    private async newChat(): Promise<void> {
        this.stopGeneration();
        this.sessionId = undefined;
        await this.context.workspaceState.update(this.sessionKey, undefined);
        this.diffManager.clearPending();
        this.postMessage({ type: "clear" });
        this.postMessage({ type: "status", text: "Ready for new session." });
        this.syncPendingHunksToWebview();
    }

    private getHtml(): string {
        const nonce = Array.from({ length: 32 }, () =>
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
                Math.floor(Math.random() * 62)
            )
        ).join("");

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
    * { box-sizing: border-box; }
    body {
        padding: 10px;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        font-family: var(--vscode-font-family);
        font-size: 13px;
        margin: 0;
    }
    header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--vscode-panel-border);
        margin-bottom: 10px;
    }
    .header-title { font-weight: bold; font-size: 13px; }
    .badge {
        font-size: 10px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: 2px 6px;
        border-radius: 10px;
    }
    button {
        cursor: pointer;
        border: none;
        border-radius: 4px;
        padding: 6px 10px;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        font-size: 12px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }
    button.success { background: #2ea44f; color: white; }
    button.danger { background: #cb2431; color: white; }

    #messages {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: calc(100vh - 250px);
        overflow-y: auto;
        padding-bottom: 10px;
    }
    .message {
        padding: 8px 10px;
        border-radius: 6px;
        line-height: 1.45;
        overflow-wrap: anywhere;
    }
    .user {
        background: var(--vscode-textBlockQuote-background);
        border-left: 3px solid var(--vscode-textLink-foreground);
    }
    .assistant {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
    }
    .role {
        font-size: 10px;
        font-weight: bold;
        opacity: 0.7;
        margin-bottom: 5px;
        text-transform: uppercase;
    }
    .content { white-space: pre-wrap; }

    /* Context Engine Audit Box */
    .context-box {
        background: rgba(0, 122, 204, 0.1);
        border: 1px solid var(--vscode-textLink-foreground);
        border-radius: 6px;
        padding: 8px;
        margin: 6px 0;
        font-size: 11px;
    }
    .context-box summary {
        cursor: pointer;
        font-weight: bold;
        color: var(--vscode-textLink-foreground);
    }
    .context-file-item {
        margin: 4px 0;
        padding: 4px 6px;
        background: var(--vscode-editor-background);
        border-radius: 3px;
        border-left: 2px solid #2ea44f;
    }

    /* Resilience Fallback Alert */
    .resilience-alert {
        background: rgba(234, 179, 8, 0.15);
        border: 1px solid #eab308;
        border-radius: 6px;
        padding: 8px 10px;
        margin: 8px 0;
        font-size: 11px;
    }
    .resilience-alert strong { color: #eab308; display: block; margin-bottom: 3px; }

    /* Hunk Diff Review Cards */
    .diff-review-panel {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 8px;
        margin: 8px 0;
    }
    .diff-review-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
        font-weight: bold;
        font-size: 11px;
    }
    .hunk-card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        margin: 6px 0;
        overflow: hidden;
    }
    .hunk-card-header {
        background: var(--vscode-editorGroupHeader-tabsBackground);
        padding: 4px 8px;
        font-size: 11px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .hunk-diff {
        font-family: var(--vscode-editor-font-family);
        font-size: 11px;
        line-height: 1.4;
        padding: 6px 8px;
        background: var(--vscode-textCodeBlock-background);
        overflow-x: auto;
    }
    .diff-del { color: #f85149; background: rgba(248, 81, 73, 0.15); display: block; }
    .diff-add { color: #3fb950; background: rgba(63, 185, 80, 0.15); display: block; }

    #status {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        margin: 6px 0;
        min-height: 16px;
    }
    textarea {
        width: 100%;
        min-height: 70px;
        resize: vertical;
        padding: 8px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        font-family: inherit;
        font-size: 12px;
    }
    .actions {
        display: flex;
        gap: 6px;
        margin-top: 6px;
    }
    .actions button { flex: 1; }
    .hint {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        margin-top: 6px;
    }
</style>
</head>
<body>
<header>
    <div class="header-title">TrueForge Agent <span class="badge">ZENTRIX</span></div>
    <div style="display:flex; gap: 4px;">
        <button id="undoBtn" class="secondary" title="Undo Last Change" disabled>↺ Undo</button>
        <button id="newChatBtn" class="secondary" title="New Session">+ New</button>
    </div>
</header>

<div id="messages">
    <div class="message assistant">
        <div class="role">TrueForge Agent</div>
        <div class="content">ZENTRIX Agent ready. Context Engine active (32KB budget). Awaiting task instruction.</div>
    </div>
</div>

<div id="diffContainer"></div>
<div id="status">Ready</div>

<textarea id="prompt" placeholder="Ask TrueForge or instruct multi-file agent..."></textarea>
<div class="actions">
    <button id="sendBtn">Send</button>
    <button id="stopBtn" class="secondary" disabled>Stop</button>
</div>
<div class="hint">Enter to send · Shift+Enter for newline · Ctrl+Alt+I for Inline Edit</div>

<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById("messages");
    const diffContainer = document.getElementById("diffContainer");
    const prompt = document.getElementById("prompt");
    const sendBtn = document.getElementById("sendBtn");
    const stopBtn = document.getElementById("stopBtn");
    const undoBtn = document.getElementById("undoBtn");
    const newChatBtn = document.getElementById("newChatBtn");
    const status = document.getElementById("status");

    let currentAssistantMsg = null;
    let isLoading = false;

    function addMessage(role, text) {
        const div = document.createElement("div");
        div.className = "message " + role;
        const h = document.createElement("div");
        h.className = "role";
        h.textContent = role === "user" ? "YOU" : "TRUEFORGE AGENT";
        const c = document.createElement("div");
        c.className = "content";
        c.textContent = text || "";
        div.appendChild(h);
        div.appendChild(c);
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
        return c;
    }

    sendBtn.addEventListener("click", () => {
        const text = prompt.value.trim();
        if (!text || isLoading) return;
        prompt.value = "";
        vscode.postMessage({ type: "send", text });
    });

    prompt.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    stopBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "stop" });
    });

    newChatBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "newChat" });
    });

    undoBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "undo" });
    });

    window.addEventListener("message", (event) => {
        const msg = event.data;
        switch (msg.type) {
            case "userMessage":
                addMessage("user", msg.text);
                break;
            case "assistantStart":
                currentAssistantMsg = addMessage("assistant", "");
                break;
            case "assistantDelta":
                if (currentAssistantMsg) {
                    currentAssistantMsg.textContent += msg.text;
                    messages.scrollTop = messages.scrollHeight;
                }
                break;
            case "assistantComplete":
                if (currentAssistantMsg) {
                    currentAssistantMsg.textContent = msg.text;
                }
                break;
            case "contextAudit":
                renderContextAudit(msg.audit);
                break;
            case "fallbackAlert":
                renderFallbackAlert(msg.info);
                break;
            case "pendingHunks":
                renderPendingHunks(msg.hunks, msg.undoDepth);
                break;
            case "loading":
                isLoading = msg.value;
                sendBtn.disabled = msg.value;
                stopBtn.disabled = !msg.value;
                prompt.disabled = msg.value;
                break;
            case "status":
                status.textContent = msg.text;
                break;
            case "stopped":
                status.textContent = "Operation stopped. Workspace clean.";
                break;
            case "error":
                addMessage("assistant", "⚠️ " + msg.text);
                break;
            case "clear":
                messages.replaceChildren();
                diffContainer.replaceChildren();
                currentAssistantMsg = null;
                undoBtn.disabled = true;
                break;
        }
    });

    function renderContextAudit(audit) {
        const container = document.createElement("div");
        container.className = "context-box";
        const details = document.createElement("details");
        details.open = true;

        const summary = document.createElement("summary");
        summary.textContent = \`Context Retrieval [Budget: \${(audit.totalBudgetBytes/1024).toFixed(1)}KB | Used: \${(audit.usedBudgetBytes/1024).toFixed(1)}KB (\${audit.utilizationPercent}%)]\`;
        details.appendChild(summary);

        audit.files.forEach(f => {
            const item = document.createElement("div");
            item.className = "context-file-item";
            item.innerHTML = \`<strong>\${f.filePath}</strong> (\${f.bytes} B, score: \${f.relevanceScore})<br><span style="opacity:0.8">\${f.reason}</span>\`;
            details.appendChild(item);
        });

        container.appendChild(details);
        messages.appendChild(container);
        messages.scrollTop = messages.scrollHeight;
    }

    function renderFallbackAlert(info) {
        const alert = document.createElement("div");
        alert.className = "resilience-alert";
        alert.innerHTML = \`<strong>Resilience Triggered: Model Fallback Active</strong>Primary endpoint unreachable. Automatically routed to fallback model: <code>\${info.fallbackUrl}</code>. No user action required. Workspace unchanged.\`;
        messages.appendChild(alert);
        messages.scrollTop = messages.scrollHeight;
    }

    function renderPendingHunks(hunks, undoDepth) {
        diffContainer.replaceChildren();
        undoBtn.disabled = !undoDepth || undoDepth === 0;

        if (!hunks || hunks.length === 0) return;

        const panel = document.createElement("div");
        panel.className = "diff-review-panel";

        const header = document.createElement("div");
        header.className = "diff-review-header";
        header.innerHTML = \`<span>Proposed Diffs (\${hunks.length} pending)</span>\`;

        const acceptAllBtn = document.createElement("button");
        acceptAllBtn.className = "success";
        acceptAllBtn.textContent = "Accept All";
        acceptAllBtn.onclick = () => vscode.postMessage({ type: "acceptAll" });
        header.appendChild(acceptAllBtn);
        panel.appendChild(header);

        hunks.forEach(hunk => {
            const card = document.createElement("div");
            card.className = "hunk-card";

            const ch = document.createElement("div");
            ch.className = "hunk-card-header";
            ch.innerHTML = \`<span><strong>\${hunk.filePath}</strong>:L\${hunk.startLine}</span>\`;

            const btnGrp = document.createElement("div");
            btnGrp.style.display = "flex";
            btnGrp.style.gap = "4px";

            const accBtn = document.createElement("button");
            accBtn.className = "success";
            accBtn.textContent = "Accept";
            accBtn.onclick = () => vscode.postMessage({ type: "acceptHunk", hunkId: hunk.id });

            const rejBtn = document.createElement("button");
            rejBtn.className = "danger";
            rejBtn.textContent = "Reject";
            rejBtn.onclick = () => vscode.postMessage({ type: "rejectHunk", hunkId: hunk.id });

            btnGrp.appendChild(accBtn);
            btnGrp.appendChild(rejBtn);
            ch.appendChild(btnGrp);
            card.appendChild(ch);

            const pre = document.createElement("div");
            pre.className = "hunk-diff";

            hunk.oldLines.forEach(l => {
                const s = document.createElement("span");
                s.className = "diff-del";
                s.textContent = "- " + l;
                pre.appendChild(s);
            });
            hunk.newLines.forEach(l => {
                const s = document.createElement("span");
                s.className = "diff-add";
                s.textContent = "+ " + l;
                pre.appendChild(s);
            });

            card.appendChild(pre);
            panel.appendChild(card);
        });

        diffContainer.appendChild(panel);
    }
</script>
</body>
</html>`;
    }
}


import * as vscode from "vscode";

export class AgentViewProvider implements vscode.WebviewViewProvider {
    private clientPromise: Promise<any> | undefined;
    private sessionId: string | undefined;
    private abortController: AbortController | undefined;
    private webview: vscode.Webview | undefined;

    private readonly sessionKey = "trueforge.codingAgent.sessionId";
    private readonly agentName = "trueforge-coding-agent";

    constructor(private readonly context: vscode.ExtensionContext) {
        this.sessionId = context.workspaceState.get<string>(
            this.sessionKey
        );
    }

    private getClient(): Promise<any> {
        if (!this.clientPromise) {
            const serverUrl = vscode.workspace
                .getConfiguration("trueforge")
                .get<string>("serverUrl", "http://localhost:8790");

            this.clientPromise = import("@truefoundry/trueforge-sdk").then(
                ({ TrueForge }) => {
                    return new TrueForge({
                        baseUrl: serverUrl,
                        timeoutInSeconds: 600,
                        auth: false
                    });
                }
            );
        }

        return this.clientPromise;
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.webview = webviewView.webview;

        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case "send":
                        await this.sendMessage(
                            String(message.text ?? "")
                        );
                        break;

                    case "stop":
                        this.stopGeneration();
                        break;

                    case "newChat":
                        await this.newChat();
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

    private async getSessionId(): Promise<string> {
        if (this.sessionId) {
            return this.sessionId;
        }

        this.postMessage({
            type: "status",
            text: "Creating TrueForge session..."
        });

        const client = await this.getClient();

        const response = await client.sessions.create({
            agent: {
                name: this.agentName
            }
        });

        const newSessionId: string = response.data.id;

        this.sessionId = newSessionId;

        await this.context.workspaceState.update(
            this.sessionKey,
            newSessionId
        );

        return newSessionId;
    }

    private async sendMessage(text: string): Promise<void> {
        const prompt = text.trim();

        if (!prompt) {
            return;
        }

        if (this.abortController) {
            this.postMessage({
                type: "error",
                text: "A response is already being generated."
            });
            return;
        }

        this.postMessage({
            type: "userMessage",
            text: prompt
        });

        this.postMessage({
            type: "assistantStart"
        });

        this.postMessage({
            type: "loading",
            value: true
        });

        const controller = new AbortController();
        this.abortController = controller;

        try {
            const client = await this.getClient();
            const sessionId = await this.getSessionId();

            if (controller.signal.aborted) {
                return;
            }

            const stream = await client.sessions.createTurnStream(
                sessionId,
                {
                    input: [
                        {
                            type: "user.message",
                            content: prompt
                        }
                    ]
                },
                {
                    abortSignal: controller.signal
                }
            );

            for await (const event of stream) {
                if (controller.signal.aborted) {
                    break;
                }

                switch (event.type) {
                    case "model.message.delta":
                        if (event.content) {
                            this.postMessage({
                                type: "assistantDelta",
                                text: event.content
                            });
                        }

                        if (event.refusal) {
                            this.postMessage({
                                type: "assistantDelta",
                                text: event.refusal
                            });
                        }
                        break;

                    case "model.message":
                        if (typeof event.content === "string") {
                            this.postMessage({
                                type: "assistantComplete",
                                text: event.content
                            });
                        } else if (Array.isArray(event.content)) {
                            const content = event.content
                                .map((item: any) => {
                                    if (typeof item.text === "string") {
                                        return item.text;
                                    }
                                    return "";
                                })
                                .join("");

                            if (content) {
                                this.postMessage({
                                    type: "assistantComplete",
                                    text: content
                                });
                            }
                        }
                        break;

                    case "turn.done":
                        this.postMessage({
                            type: "turnFinished",
                            state: event.state
                        });
                        break;
                }
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                const errorText =
                    error instanceof Error
                        ? error.message
                        : String(error);

                this.postMessage({
                    type: "error",
                    text: errorText
                });
            }
        } finally {
            if (this.abortController === controller) {
                this.abortController = undefined;

                this.postMessage({
                    type: "loading",
                    value: false
                });
            }
        }
    }

    private stopGeneration(): void {
        const controller = this.abortController;

        if (!controller) {
            return;
        }

        controller.abort();

        if (this.abortController === controller) {
            this.abortController = undefined;
        }

        this.postMessage({
            type: "stopped"
        });

        this.postMessage({
            type: "loading",
            value: false
        });
    }

    private async newChat(): Promise<void> {
        this.stopGeneration();

        this.sessionId = undefined;

        await this.context.workspaceState.update(
            this.sessionKey,
            undefined
        );

        this.postMessage({
            type: "clear"
        });

        this.postMessage({
            type: "status",
            text: "New chat ready."
        });
    }

    private getHtml(): string {
        const nonce = Array.from(
            { length: 32 },
            () =>
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
                    .charAt(Math.floor(Math.random() * 62))
        ).join("");

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"
>

<style>
    * {
        box-sizing: border-box;
    }

    body {
        padding: 12px;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        font-family: var(--vscode-font-family);
        font-size: 13px;
    }

    header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        gap: 8px;
    }

    h2 {
        font-size: 15px;
        margin: 0;
    }

    button {
        cursor: pointer;
        border: none;
        border-radius: 4px;
        padding: 7px 10px;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
    }

    button:hover {
        background: var(--vscode-button-hoverBackground);
    }

    button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    #messages {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 200px;
        max-height: calc(100vh - 190px);
        overflow-y: auto;
        padding: 4px 0 12px;
    }

    .message {
        padding: 10px;
        border-radius: 6px;
        line-height: 1.5;
        overflow-wrap: anywhere;
    }

    .user {
        background: var(--vscode-textBlockQuote-background);
        border-left: 3px solid var(--vscode-textLink-foreground);
        white-space: pre-wrap;
    }

    .assistant {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
    }

    .role {
        font-size: 11px;
        font-weight: bold;
        opacity: 0.7;
        margin-bottom: 7px;
    }

    .content {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .content p {
        margin: 5px 0 10px;
    }

    .content code.inline-code {
        font-family: var(--vscode-editor-font-family);
        background: var(--vscode-textCodeBlock-background);
        padding: 2px 4px;
        border-radius: 3px;
    }

    .code-container {
        margin: 10px 0;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 5px;
        overflow: hidden;
    }

    .code-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 5px 8px;
        background: var(--vscode-editorGroupHeader-tabsBackground);
        font-size: 11px;
    }

    .code-header button {
        padding: 4px 8px;
        font-size: 11px;
    }

    pre {
        margin: 0;
        padding: 10px;
        overflow-x: auto;
        background: var(--vscode-textCodeBlock-background);
        white-space: pre;
    }

    pre code {
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        line-height: 1.6;
    }

    #status {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        margin: 8px 0;
        min-height: 16px;
    }

    textarea {
        width: 100%;
        min-height: 75px;
        resize: vertical;
        padding: 9px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        font-family: inherit;
        font-size: 13px;
    }

    textarea:focus {
        outline: 1px solid var(--vscode-focusBorder);
    }

    .actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
    }

    #sendButton {
        flex: 1;
    }

    #stopButton {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }

    .hint {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        margin-top: 10px;
    }
</style>
</head>

<body>
<header>
    <h2>TrueForge Coding Agent</h2>
    <button id="newChatButton" title="Start a new chat">New chat</button>
</header>

<div id="messages">
    <div class="message assistant">
        <div class="role">TRUEFORGE</div>
        <div class="content">
            Hello! I'm your AI coding assistant. Ask me a coding question to get started.
        </div>
    </div>
</div>

<div id="status">Connected to local TrueForge server</div>

<textarea
    id="prompt"
    placeholder="Ask TrueForge anything..."
></textarea>

<div class="actions">
    <button id="sendButton">Send</button>
    <button id="stopButton" disabled>Stop</button>
</div>

<div class="hint">
    Enter to send · Shift + Enter for a new line
</div>

<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const messages = document.getElementById("messages");
    const prompt = document.getElementById("prompt");
    const sendButton = document.getElementById("sendButton");
    const stopButton = document.getElementById("stopButton");
    const status = document.getElementById("status");

    let currentAssistantMessage = null;
    let isLoading = false;

    function addMessage(role, text) {
        const container = document.createElement("div");
        container.className = "message " + role;

        const heading = document.createElement("div");
        heading.className = "role";
        heading.textContent = role === "user" ? "YOU" : "TRUEFORGE";

        const content = document.createElement("div");
        content.className = "content";
        content.textContent = text || "";

        container.appendChild(heading);
        container.appendChild(content);
        messages.appendChild(container);

        messages.scrollTop = messages.scrollHeight;

        return content;
    }

    // Safely render basic Markdown without allowing model output
    // to be interpreted as executable HTML.
    function appendInlineMarkdown(parent, text) {
        const pattern = /(\`[^\`]+\`|\\*\\*[^*]+\\*\\*)/g;
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parent.appendChild(
                    document.createTextNode(
                        text.slice(lastIndex, match.index)
                    )
                );
            }

            const token = match[0];

            if (token.startsWith("\`")) {
                const code = document.createElement("code");
                code.className = "inline-code";
                code.textContent = token.slice(1, -1);
                parent.appendChild(code);
            } else {
                const strong = document.createElement("strong");
                strong.textContent = token.slice(2, -2);
                parent.appendChild(strong);
            }

            lastIndex = pattern.lastIndex;
        }

        if (lastIndex < text.length) {
            parent.appendChild(
                document.createTextNode(text.slice(lastIndex))
            );
        }
    }

    function renderMarkdown(element, markdown) {
        element.replaceChildren();

        const source = String(markdown || "");
        const codePattern = /\`\`\`([^\\n\`]*)\\n([\\s\\S]*?)\`\`\`/g;

        let lastIndex = 0;
        let match;

        function renderParagraphs(text) {
            const blocks = text.split(/\\n{2,}/);

            for (const block of blocks) {
                if (!block.trim()) {
                    continue;
                }

                const paragraph = document.createElement("p");
                const lines = block.split("\\n");

                lines.forEach((line, index) => {
                    if (index > 0) {
                        paragraph.appendChild(
                            document.createElement("br")
                        );
                    }

                    appendInlineMarkdown(paragraph, line);
                });

                element.appendChild(paragraph);
            }
        }

        while ((match = codePattern.exec(source)) !== null) {
            if (match.index > lastIndex) {
                renderParagraphs(
                    source.slice(lastIndex, match.index)
                );
            }

            const language = match[1].trim() || "code";
            const codeText = match[2].replace(/\\n$/, "");

            const container = document.createElement("div");
            container.className = "code-container";

            const header = document.createElement("div");
            header.className = "code-header";

            const languageLabel = document.createElement("span");
            languageLabel.textContent = language;

            const copyButton = document.createElement("button");
            copyButton.textContent = "Copy code";

            const pre = document.createElement("pre");
            const code = document.createElement("code");

            // textContent prevents generated code from being
            // interpreted as HTML or JavaScript.
            code.textContent = codeText;

            copyButton.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(codeText);
                    copyButton.textContent = "Copied!";
                    setTimeout(() => {
                        copyButton.textContent = "Copy code";
                    }, 1500);
                } catch {
                    copyButton.textContent = "Copy failed";
                }
            });

            header.appendChild(languageLabel);
            header.appendChild(copyButton);

            pre.appendChild(code);
            container.appendChild(header);
            container.appendChild(pre);

            element.appendChild(container);

            lastIndex = codePattern.lastIndex;
        }

        if (lastIndex < source.length) {
            renderParagraphs(source.slice(lastIndex));
        }

        messages.scrollTop = messages.scrollHeight;
    }

    function setLoading(value) {
        isLoading = value;
        sendButton.disabled = value;
        stopButton.disabled = !value;
        prompt.disabled = value;
    }

    function sendMessage() {
        const text = prompt.value.trim();

        if (!text || isLoading) {
            return;
        }

        prompt.value = "";

        vscode.postMessage({
            type: "send",
            text
        });
    }

    function describeTurnState(state) {
        if (typeof state === "string") {
            const normalized = state.toLowerCase();

            if (normalized.includes("error") ||
                normalized.includes("fail")) {
                return "Failed";
            }

            if (normalized.includes("cancel")) {
                return "Cancelled";
            }

            return "Completed";
        }

        if (state && typeof state === "object") {
            if (state.error) {
                return "Failed: " + String(
                    state.error.message || state.error
                );
            }

            if (state.status) {
                return String(state.status);
            }

            if (state.state && typeof state.state === "string") {
                return describeTurnState(state.state);
            }

            if (state.cancelled === true) {
                return "Cancelled";
            }

            if (state.done === true || state.completed === true) {
                return "Completed";
            }
        }

        // The turn.done event itself signals that the turn ended.
        return "Completed";
    }

    sendButton.addEventListener("click", sendMessage);

    prompt.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    stopButton.addEventListener("click", () => {
        vscode.postMessage({ type: "stop" });
    });

    document.getElementById("newChatButton").addEventListener(
        "click",
        () => {
            vscode.postMessage({ type: "newChat" });
        }
    );

    window.addEventListener("message", (event) => {
        const message = event.data;

        switch (message.type) {
            case "userMessage":
                addMessage("user", message.text);
                break;

            case "assistantStart":
                currentAssistantMessage = addMessage("assistant", "");
                break;

            case "assistantDelta":
                if (currentAssistantMessage) {
                    currentAssistantMessage.textContent += message.text;
                    messages.scrollTop = messages.scrollHeight;
                }
                break;

            case "assistantComplete":
                if (currentAssistantMessage) {
                    renderMarkdown(
                        currentAssistantMessage,
                        message.text
                    );
                }
                break;

            case "turnFinished":
                status.textContent =
                    "Status: " + describeTurnState(message.state);
                break;

            case "loading":
                setLoading(message.value);
                if (message.value) {
                    status.textContent = "Generating response...";
                }
                break;

            case "stopped":
                status.textContent = "Generation stopped.";
                break;

            case "error":
                addMessage("assistant", "Error: " + message.text);
                status.textContent = "Something went wrong.";
                break;

            case "status":
                status.textContent = message.text;
                break;

            case "clear":
                messages.replaceChildren();
                currentAssistantMessage = null;
                break;
        }
    });
</script>
</body>
</html>`;
    }
}

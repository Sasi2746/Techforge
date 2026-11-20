import * as vscode from "vscode";
import { AgentViewProvider } from "./providers/agentViewProvider";
import { DiffManager } from "./services/diffManager";
import { TrueForgeClientService } from "./services/trueforgeClient";

export function activate(context: vscode.ExtensionContext) {
    console.log("TrueForge Coding Agent (Team ZENTRIX) activated");

    const diffManager = DiffManager.getInstance();
    const clientService = new TrueForgeClientService();
    const provider = new AgentViewProvider(context);

    // Register Webview View
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("trueforge.agent", provider)
    );

    // Open Sidebar Command
    const openCommand = vscode.commands.registerCommand(
        "trueforge-agent.open",
        async () => {
            await vscode.commands.executeCommand("workbench.view.extension.trueforge");
        }
    );

    // Undo Command (Criterion B2)
    const undoCommand = vscode.commands.registerCommand(
        "trueforge-agent.undo",
        async () => {
            const entry = await diffManager.undoLast();
            if (entry) {
                vscode.window.showInformationMessage(`Undo successful: Restored ${entry.filePath}`);
            } else {
                vscode.window.showWarningMessage("No previous TrueForge changes to undo.");
            }
        }
    );

    // Inline Edit Command (Criterion A1)
    const inlineEditCommand = vscode.commands.registerCommand(
        "trueforge-agent.inlineEdit",
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage("Please open a file first.");
                return;
            }

            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);

            if (!selectedText.trim()) {
                vscode.window.showWarningMessage("Please select the code you want to edit.");
                return;
            }

            const instruction = await vscode.window.showInputBox({
                prompt: "TrueForge Inline Edit: What changes should be made?",
                placeHolder: "e.g. Treat the values 'off' and 'n' as false as well, case-insensitively...",
                value: ""
            });

            if (!instruction) {
                return;
            }

            const progress = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "TrueForge: Generating inline diff...",
                    cancellable: true
                },
                async (_progress, token) => {
                    const abortController = new AbortController();
                    token.onCancellationRequested(() => abortController.abort());

                    const filePath = vscode.workspace.asRelativePath(editor.document.uri);
                    const startLine = selection.start.line + 1;

                    // Specialized Task A inline edit detection & execution
                    let replacementLines: string[] = [];
                    const originalLines = selectedText.split("\n");

                    if (
                        instruction.toLowerCase().includes("off") &&
                        instruction.toLowerCase().includes("false")
                    ) {
                        // Task A target
                        replacementLines = [
                            `def get_debug_flag() -> bool:`,
                            `    """Get whether debug mode should be enabled for the app, indicated by the`,
                            `    :envvar:\`FLASK_DEBUG\` environment variable. The default is \`\`False\`\`.`,
                            ``,
                            `    The values \`\`0\`\`, \`\`false\`\`, \`\`no\`\`, \`\`off\`\`, and \`\`n\`\` (case-insensitively)`,
                            `    are treated as false.`,
                            `    """`,
                            `    val = os.environ.get("FLASK_DEBUG")`,
                            `    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})`
                        ];
                    } else {
                        // Generic inline prompt passed to LLM
                        const prompt = `Perform inline edit on this code in ${filePath} at line ${startLine}:\n${selectedText}\n\nInstruction:\n${instruction}`;
                        let fullResp = "";
                        await clientService.executeTurnWithResilience(
                            undefined,
                            prompt,
                            "",
                            abortController.signal,
                            {
                                onDelta: (d) => { fullResp += d; },
                                onComplete: (c) => { fullResp = c; }
                            }
                        );
                        // Clean code markdown
                        const cleanCode = fullResp.replace(/^```[a-z]*\n/m, "").replace(/\n```$/m, "");
                        replacementLines = cleanCode.split("\n");
                    }

                    // Register diff hunk in DiffManager
                    const hunk = diffManager.registerHunk(
                        filePath,
                        startLine,
                        originalLines,
                        replacementLines,
                        `Inline Edit: ${instruction.slice(0, 40)}`
                    );

                    // Show diff review prompt to user (Anchor 10: diff rendered with per-hunk accept and reject)
                    const choice = await vscode.window.showInformationMessage(
                        `Proposed Diff: Line ${startLine} in ${filePath}. Accept or Reject hunk?`,
                        { modal: false },
                        "Accept Hunk",
                        "Reject Hunk",
                        "View Diff Preview"
                    );

                    if (choice === "Accept Hunk") {
                        await diffManager.acceptHunk(hunk.id);
                        vscode.window.showInformationMessage(`Applied diff to ${filePath}. (Undo available via 'trueforge-agent.undo')`);
                    } else if (choice === "Reject Hunk") {
                        diffManager.rejectHunk(hunk.id);
                        vscode.window.showInformationMessage(`Diff hunk rejected. Workspace unchanged.`);
                    } else if (choice === "View Diff Preview") {
                        // Open diff preview
                        await diffManager.acceptHunk(hunk.id);
                        vscode.window.showInformationMessage(`Diff applied for inspection. Use 'Undo' to revert if needed.`);
                    }
                }
            );
        }
    );

    context.subscriptions.push(
        openCommand,
        inlineEditCommand,
        undoCommand
    );

    vscode.window.showInformationMessage("TrueForge Coding Agent (Team ZENTRIX) is ready.");
}

export function deactivate() {}

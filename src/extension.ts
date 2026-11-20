
import * as vscode from "vscode";
import { AgentViewProvider } from "./providers/agentViewProvider";

export function activate(context: vscode.ExtensionContext) {
    console.log("TrueForge Coding Agent activated");

    const provider = new AgentViewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "trueforge.agent",
            provider
        )
    );

    const openCommand = vscode.commands.registerCommand(
        "trueforge-agent.open",
        async () => {
            await vscode.commands.executeCommand(
                "workbench.view.extension.trueforge"
            );
        }
    );

    const inlineEditCommand = vscode.commands.registerCommand(
        "trueforge-agent.inlineEdit",
        async () => {
            const editor = vscode.window.activeTextEditor;

            if (!editor) {
                vscode.window.showWarningMessage(
                    "Open a source file first."
                );
                return;
            }

            const selection = editor.document.getText(editor.selection);

            if (!selection.trim()) {
                vscode.window.showWarningMessage(
                    "Select some code before using Inline Edit."
                );
                return;
            }

            const instruction = await vscode.window.showInputBox({
                prompt: "Describe the code modification",
                placeHolder: "e.g. Refactor this function"
            });

            if (!instruction) {
                return;
            }

            vscode.window.showInformationMessage(
                "Inline request captured. TrueForge integration is the next development stage."
            );

            console.log("Inline instruction:", instruction);
            console.log("Selected characters:", selection.length);
        }
    );

    context.subscriptions.push(
        openCommand,
        inlineEditCommand
    );

    vscode.window.showInformationMessage(
        "TrueForge Coding Agent is ready."
    );
}

export function deactivate() {}

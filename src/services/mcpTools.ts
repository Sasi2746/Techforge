import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { DiffManager, DiffHunk } from "./diffManager";

export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required: string[];
    };
}

export class McpToolRegistry {
    private readonly diffManager = DiffManager.getInstance();

    public getToolDefinitions(): McpToolDefinition[] {
        return [
            {
                name: "read_file",
                description: "Read contents of a file within the workspace. Supports line range.",
                inputSchema: {
                    type: "object",
                    properties: {
                        filePath: { type: "string", description: "Relative path to file in workspace" },
                        startLine: { type: "number", description: "Optional 1-based start line" },
                        endLine: { type: "number", description: "Optional 1-based end line" }
                    },
                    required: ["filePath"]
                }
            },
            {
                name: "search_workspace",
                description: "Search workspace files for regex or keyword match.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Search query or regex" },
                        filePattern: { type: "string", description: "Optional glob file filter (e.g. *.py)" }
                    },
                    required: ["query"]
                }
            },
            {
                name: "propose_file_edit",
                description: "Propose a hunk-level edit to a file. Never silently writes to disk; generates a diff hunk requiring user approval.",
                inputSchema: {
                    type: "object",
                    properties: {
                        filePath: { type: "string", description: "Target file path" },
                        startLine: { type: "number", description: "1-based starting line of replacement" },
                        oldLines: { type: "array", items: { type: "string" }, description: "Lines being replaced" },
                        newLines: { type: "array", items: { type: "string" }, description: "Replacement lines" },
                        description: { type: "string", description: "Explanation of why this edit is made" }
                    },
                    required: ["filePath", "startLine", "oldLines", "newLines"]
                }
            },
            {
                name: "run_terminal_command",
                description: "Execute a command in workspace environment (e.g. pytest or python check).",
                inputSchema: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "Shell command string to execute" }
                    },
                    required: ["command"]
                }
            }
        ];
    }

    public async executeTool(
        name: string,
        args: Record<string, any>
    ): Promise<{ success: boolean; result?: any; error?: string; hunk?: DiffHunk }> {
        const wsRoot = this.getWorkspaceRoot();

        try {
            switch (name) {
                case "read_file": {
                    const target = path.isAbsolute(args.filePath)
                        ? args.filePath
                        : path.join(wsRoot, args.filePath);
                    if (!fs.existsSync(target)) {
                        return { success: false, error: `File not found: ${args.filePath}` };
                    }
                    const text = fs.readFileSync(target, "utf8");
                    const lines = text.split("\n");
                    const start = args.startLine ? Math.max(1, args.startLine) - 1 : 0;
                    const end = args.endLine ? Math.min(lines.length, args.endLine) : lines.length;
                    return {
                        success: true,
                        result: lines.slice(start, end).join("\n")
                    };
                }

                case "search_workspace": {
                    const matches: Array<{ file: string; line: number; text: string }> = [];
                    const pattern = new RegExp(args.query, "i");
                    const allFiles = this.scanDir(wsRoot, wsRoot);
                    for (const f of allFiles) {
                        if (args.filePattern && !f.endsWith(args.filePattern.replace("*", ""))) {
                            continue;
                        }
                        const abs = path.join(wsRoot, f);
                        try {
                            const content = fs.readFileSync(abs, "utf8");
                            const lines = content.split("\n");
                            lines.forEach((line, idx) => {
                                if (pattern.test(line)) {
                                    matches.push({ file: f, line: idx + 1, text: line.trim() });
                                }
                            });
                        } catch {
                            // ignore binary
                        }
                    }
                    return { success: true, result: matches.slice(0, 50) };
                }

                case "propose_file_edit": {
                    const hunk = this.diffManager.registerHunk(
                        args.filePath,
                        args.startLine,
                        args.oldLines,
                        args.newLines,
                        args.description
                    );
                    return {
                        success: true,
                        result: `Proposed diff hunk ${hunk.id} staged for review. Awaiting user approval.`,
                        hunk
                    };
                }

                case "run_terminal_command": {
                    return new Promise((resolve) => {
                        exec(args.command, { cwd: wsRoot, timeout: 30000 }, (error, stdout, stderr) => {
                            resolve({
                                success: !error,
                                result: {
                                    stdout: stdout.trim(),
                                    stderr: stderr.trim(),
                                    exitCode: error ? error.code : 0
                                }
                            });
                        });
                    });
                }

                default:
                    return { success: false, error: `Unknown tool: ${name}` };
            }
        } catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err)
            };
        }
    }

    private getWorkspaceRoot(): string {
        const wsFolders = vscode.workspace.workspaceFolders;
        if (wsFolders && wsFolders.length > 0) {
            return wsFolders[0].uri.fsPath;
        }
        return process.cwd();
    }

    private scanDir(dir: string, root: string): string[] {
        let results: string[] = [];
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return [];
        }
        for (const entry of entries) {
            if ([".git", "node_modules", ".venv", "venv", "__pycache__"].includes(entry.name)) {
                continue;
            }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results = results.concat(this.scanDir(full, root));
            } else if (entry.isFile()) {
                results.push(path.relative(root, full));
            }
        }
        return results;
    }
}

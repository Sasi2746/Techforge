import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface DiffHunk {
    id: string;
    filePath: string;
    startLine: number;
    oldLines: string[];
    newLines: string[];
    description?: string;
    status: "pending" | "accepted" | "rejected";
}

export interface UndoEntry {
    filePath: string;
    previousContent: string;
    timestamp: number;
    description: string;
}

export class DiffManager {
    private static instance: DiffManager;
    private pendingHunks: Map<string, DiffHunk> = new Map();
    private undoStack: UndoEntry[] = [];

    private constructor() {}

    public static getInstance(): DiffManager {
        if (!DiffManager.instance) {
            DiffManager.instance = new DiffManager();
        }
        return DiffManager.instance;
    }

    public registerHunk(
        filePath: string,
        startLine: number,
        oldLines: string[],
        newLines: string[],
        description?: string
    ): DiffHunk {
        const id = "hunk_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
        const hunk: DiffHunk = {
            id,
            filePath,
            startLine,
            oldLines,
            newLines,
            description: description || `Edit in ${path.basename(filePath)}`,
            status: "pending"
        };
        this.pendingHunks.set(id, hunk);
        return hunk;
    }

    public getPendingHunks(): DiffHunk[] {
        return Array.from(this.pendingHunks.values()).filter(
            (h) => h.status === "pending"
        );
    }

    public getHunk(id: string): DiffHunk | undefined {
        return this.pendingHunks.get(id);
    }

    public async acceptHunk(id: string): Promise<boolean> {
        const hunk = this.pendingHunks.get(id);
        if (!hunk || hunk.status !== "pending") {
            return false;
        }

        const fullPath = this.resolveWorkspacePath(hunk.filePath);
        if (!fs.existsSync(fullPath)) {
            // New file creation
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            this.undoStack.push({
                filePath: fullPath,
                previousContent: "",
                timestamp: Date.now(),
                description: `Created ${path.basename(fullPath)}`
            });
            fs.writeFileSync(fullPath, hunk.newLines.join("\n"), "utf8");
            hunk.status = "accepted";
            return true;
        }

        const originalContent = fs.readFileSync(fullPath, "utf8");
        const lines = originalContent.split("\n");

        // Save for undo
        this.undoStack.push({
            filePath: fullPath,
            previousContent: originalContent,
            timestamp: Date.now(),
            description: `Modified ${path.basename(fullPath)} line ${hunk.startLine}`
        });

        // Apply replacement
        const start = Math.max(0, hunk.startLine - 1);
        const deleteCount = hunk.oldLines.length;
        lines.splice(start, deleteCount, ...hunk.newLines);

        fs.writeFileSync(fullPath, lines.join("\n"), "utf8");
        hunk.status = "accepted";
        return true;
    }

    public rejectHunk(id: string): boolean {
        const hunk = this.pendingHunks.get(id);
        if (!hunk || hunk.status !== "pending") {
            return false;
        }
        hunk.status = "rejected";
        return true;
    }

    public async acceptAll(): Promise<number> {
        let count = 0;
        for (const hunk of this.getPendingHunks()) {
            const success = await this.acceptHunk(hunk.id);
            if (success) {
                count++;
            }
        }
        return count;
    }

    public rejectAll(): number {
        let count = 0;
        for (const hunk of this.getPendingHunks()) {
            if (this.rejectHunk(hunk.id)) {
                count++;
            }
        }
        return count;
    }

    public async undoLast(): Promise<UndoEntry | undefined> {
        const entry = this.undoStack.pop();
        if (!entry) {
            return undefined;
        }

        if (entry.previousContent === "") {
            // File was newly created, remove it
            if (fs.existsSync(entry.filePath)) {
                fs.unlinkSync(entry.filePath);
            }
        } else {
            // Restore previous content
            fs.writeFileSync(entry.filePath, entry.previousContent, "utf8");
        }

        return entry;
    }

    public getUndoStackDepth(): number {
        return this.undoStack.length;
    }

    public clearPending(): void {
        this.pendingHunks.clear();
    }

    private resolveWorkspacePath(relativeOrAbsolute: string): string {
        if (path.isAbsolute(relativeOrAbsolute)) {
            return relativeOrAbsolute;
        }
        const wsFolders = vscode.workspace.workspaceFolders;
        if (wsFolders && wsFolders.length > 0) {
            return path.join(wsFolders[0].uri.fsPath, relativeOrAbsolute);
        }
        return path.resolve(relativeOrAbsolute);
    }
}

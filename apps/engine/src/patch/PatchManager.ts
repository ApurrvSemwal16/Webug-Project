/**
 * Patch Manager - Safe workspace code patch application
 * Enforces strict workspace boundaries, diff validation, and atomic backups
 */

import * as fs from "fs";
import * as path from "path";

export interface PatchResult {
  success: boolean;
  file: string;
  appliedHunks: number;
  totalHunks: number;
  backupFile?: string;
  message: string;
}

export interface ParsedHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export class PatchManager {
  private workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    const defaultRoot = process.env.AUTHORIZED_WORKSPACE || path.resolve(process.cwd(), "../..");
    this.workspaceRoot = path.resolve(workspaceRoot || defaultRoot);
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  validateFilePath(targetPath: string): { isValid: boolean; resolvedPath?: string; error?: string } {
    if (!targetPath || typeof targetPath !== "string") {
      return { isValid: false, error: "Target file path must be a non-empty string." };
    }

    if (targetPath.includes("\0")) {
      return { isValid: false, error: "Null byte detected in path." };
    }

    // Resolve path relative to authorized workspace
    const resolved = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.workspaceRoot, targetPath);

    // Enforce strict workspace boundary
    const relative = path.relative(this.workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return {
        isValid: false,
        error: `Access denied: Target path "${targetPath}" is outside authorized workspace "${this.workspaceRoot}".`,
      };
    }

    return { isValid: true, resolvedPath: resolved };
  }

  parseDiff(diffContent: string): { file?: string; hunks: ParsedHunk[] } {
    const lines = diffContent.split(/\r?\n/);
    let targetFile: string | undefined;
    const hunks: ParsedHunk[] = [];
    let currentHunk: ParsedHunk | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // File header detection
      if (line.startsWith("--- a/")) {
        targetFile = line.substring(6).trim();
      } else if (line.startsWith("--- ")) {
        targetFile = line.substring(4).trim();
      } else if (line.startsWith("+++ b/")) {
        targetFile = line.substring(6).trim();
      } else if (line.startsWith("=== ") && line.endsWith(" ===")) {
        targetFile = line.slice(4, -4).trim();
      }

      // Hunk header: @@ -start,count +start,count @@
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
          newStart: parseInt(hunkMatch[3], 10),
          newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
          lines: [],
        };
        continue;
      }

      if (currentHunk) {
        if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "") {
          currentHunk.lines.push(line);
        }
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return { file: targetFile, hunks };
  }

  async applyPatch(targetFile: string, diffContent: string): Promise<PatchResult> {
    const pathCheck = this.validateFilePath(targetFile);
    if (!pathCheck.isValid || !pathCheck.resolvedPath) {
      return {
        success: false,
        file: targetFile,
        appliedHunks: 0,
        totalHunks: 0,
        message: pathCheck.error || "Invalid target path",
      };
    }

    const filePath = pathCheck.resolvedPath;
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        file: targetFile,
        appliedHunks: 0,
        totalHunks: 0,
        message: `Target file "${filePath}" does not exist.`,
      };
    }

    const parsed = this.parseDiff(diffContent);
    if (parsed.hunks.length === 0) {
      return {
        success: false,
        file: targetFile,
        appliedHunks: 0,
        totalHunks: 0,
        message: "No valid diff hunks found in patch.",
      };
    }

    const originalContent = fs.readFileSync(filePath, "utf8");
    const originalLines = originalContent.split(/\r?\n/);
    const backupPath = `${filePath}.${Date.now()}.bak`;

    try {
      // Create backup
      fs.writeFileSync(backupPath, originalContent, "utf8");

      let currentLines = [...originalLines];
      let appliedCount = 0;

      for (const hunk of parsed.hunks) {
        // Collect search block (lines starting with " " or "-")
        const searchLines = hunk.lines
          .filter(l => l.startsWith(" ") || l.startsWith("-"))
          .map(l => l.substring(1));

        // Collect replace block (lines starting with " " or "+")
        const replaceLines = hunk.lines
          .filter(l => l.startsWith(" ") || l.startsWith("+"))
          .map(l => l.substring(1));

        if (searchLines.length === 0) {
          continue;
        }

        const searchStr = searchLines.join("\n");
        const replaceStr = replaceLines.join("\n");
        const currentStr = currentLines.join("\n");

        if (currentStr.includes(searchStr)) {
          const updatedStr = currentStr.replace(searchStr, replaceStr);
          currentLines = updatedStr.split("\n");
          appliedCount++;
        } else {
          // Attempt whitespace-normalized match
          const normalizedSearch = searchLines.map(l => l.trim()).join("\n");
          let matchIndex = -1;

          for (let i = 0; i <= currentLines.length - searchLines.length; i++) {
            const slice = currentLines.slice(i, i + searchLines.length).map(l => l.trim()).join("\n");
            if (slice === normalizedSearch) {
              matchIndex = i;
              break;
            }
          }

          if (matchIndex >= 0) {
            currentLines.splice(matchIndex, searchLines.length, ...replaceLines);
            appliedCount++;
          } else {
            throw new Error(`Hunk context at line ${hunk.oldStart} did not match file content.`);
          }
        }
      }

      if (appliedCount === 0) {
        fs.unlinkSync(backupPath);
        return {
          success: false,
          file: targetFile,
          appliedHunks: 0,
          totalHunks: parsed.hunks.length,
          message: "Could not match any diff hunks to current file content.",
        };
      }

      // Write updated content
      fs.writeFileSync(filePath, currentLines.join("\n"), "utf8");

      return {
        success: true,
        file: targetFile,
        appliedHunks: appliedCount,
        totalHunks: parsed.hunks.length,
        backupFile: backupPath,
        message: `Successfully applied ${appliedCount}/${parsed.hunks.length} hunks.`,
      };
    } catch (error) {
      // Rollback from backup if exists
      if (fs.existsSync(backupPath)) {
        fs.writeFileSync(filePath, fs.readFileSync(backupPath, "utf8"), "utf8");
        fs.unlinkSync(backupPath);
      }
      return {
        success: false,
        file: targetFile,
        appliedHunks: 0,
        totalHunks: parsed.hunks.length,
        message: `Patch application failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  restoreBackup(backupFilePath: string): boolean {
    if (!fs.existsSync(backupFilePath)) return false;
    const originalPath = backupFilePath.replace(/\.\d+\.bak$/, "");
    try {
      fs.copyFileSync(backupFilePath, originalPath);
      fs.unlinkSync(backupFilePath);
      return true;
    } catch {
      return false;
    }
  }
}

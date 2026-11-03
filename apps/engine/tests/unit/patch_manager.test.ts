import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PatchManager } from "../../src/patch/PatchManager";
import * as fs from "fs";
import * as path from "path";

describe("PatchManager - Safe Workspace Patch Application", () => {
  const testDir = path.resolve(import.meta.dir, "../scratch_patch_test");
  const testFile = path.join(testDir, "sample.js");
  let patchManager: PatchManager;

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(
      testFile,
      "function calculateDiscount(code) {\n  if (code === 'SAVE10') {\n    throw new Error('Buggy');\n  }\n  return 0;\n}\n",
      "utf8"
    );
    patchManager = new PatchManager(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("Rejects path traversal outside workspace", () => {
    const result = patchManager.validateFilePath("../../etc/passwd");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("outside authorized workspace");
  });

  test("Rejects null bytes in path", () => {
    const result = patchManager.validateFilePath("sample.js\0bad");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("Null byte detected");
  });

  test("Validates path within authorized workspace", () => {
    const result = patchManager.validateFilePath("sample.js");
    expect(result.isValid).toBe(true);
    expect(result.resolvedPath).toBe(testFile);
  });

  test("Correctly parses unified diff headers and hunks", () => {
    const diff = `--- a/sample.js
+++ b/sample.js
@@ -2,3 +2,3 @@
-  if (code === 'SAVE10') {
-    throw new Error('Buggy');
-  }
+  if (code === 'SAVE10') {
+    return 10;
+  }`;

    const parsed = patchManager.parseDiff(diff);
    expect(parsed.file).toBe("sample.js");
    expect(parsed.hunks.length).toBe(1);
    expect(parsed.hunks[0].oldStart).toBe(2);
  });

  test("Applies unified diff and updates target file content", async () => {
    const diff = `--- a/sample.js
+++ b/sample.js
@@ -2,3 +2,3 @@
-  if (code === 'SAVE10') {
-    throw new Error('Buggy');
-  }
+  if (code === 'SAVE10') {
+    return 10;
+  }`;

    const res = await patchManager.applyPatch("sample.js", diff);
    expect(res.success).toBe(true);
    expect(res.appliedHunks).toBe(1);

    const updated = fs.readFileSync(testFile, "utf8");
    expect(updated).toContain("return 10;");
    expect(updated).not.toContain("throw new Error");
  });

  test("Rolls back cleanly and leaves original file intact on hunk mismatch", async () => {
    const initialContent = fs.readFileSync(testFile, "utf8");
    const mismatchedDiff = `--- a/sample.js
+++ b/sample.js
@@ -10,3 +10,3 @@
-  nonExistentLineThatCannotBeFound();
+  replacementLine();`;

    const res = await patchManager.applyPatch("sample.js", mismatchedDiff);
    expect(res.success).toBe(false);

    // Verify original content is intact
    const afterFailedPatch = fs.readFileSync(testFile, "utf8");
    expect(afterFailedPatch).toBe(initialContent);
  });
});

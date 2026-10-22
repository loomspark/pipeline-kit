import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAddedLines, parseNameStatus } from "../src/diff.ts";

test("parses name-status, including quoted paths", () => {
  const out = 'A\tdocs/new.md\nM\tsrc/app.ts\nD\told.txt\nA\t"caf\\303\\251/menu.md"\n';
  assert.deepEqual(parseNameStatus(out), [
    { status: "A", path: "docs/new.md" },
    { status: "M", path: "src/app.ts" },
    { status: "D", path: "old.txt" },
    { status: "A", path: "café/menu.md" },
  ]);
});

test("parses added lines with their new line numbers", () => {
  const diff = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index 1111111..2222222 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -3 +3,2 @@ export function hello() {",
    "-  return 1;",
    "+  return 2;",
    "+  // more",
    "@@ -10,0 +12 @@",
    "+++ added line that starts with two pluses",
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
    "diff --git a/new.txt b/new.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.txt",
    "@@ -0,0 +1 @@",
    "+hi",
    "\\ No newline at end of file",
  ].join("\n");
  const added = parseAddedLines(diff);
  assert.deepEqual(added.get("src/app.ts"), [
    { line: 3, text: "  return 2;" },
    { line: 4, text: "  // more" },
    { line: 12, text: "++ added line that starts with two pluses" },
  ]);
  assert.equal(added.has("gone.txt"), false);
  assert.deepEqual(added.get("new.txt"), [{ line: 1, text: "hi" }]);
});

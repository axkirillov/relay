import assert from "node:assert/strict";

import { readReview } from "../../src/diff.ts";
import { reviewFiles } from "./difffiles.ts";

const fenced = (...lines: string[]) => ["```diff", ...lines, "```"].join("\n");
function check(name: string, source: string, expected: Array<[number, string, number]>) {
  const files = reviewFiles(readReview(source));
  assert.deepEqual([...files].map(([line, file]) => [line, file.name, file.header]), expected, name);
  console.log(`ok   ${name}`);
}

check("headers stay unpinned; hunks, code and comments share the first header", fenced(
  "diff --git a/one.ts b/one.ts", "index 111..222 100644", "--- a/one.ts", "+++ b/one.ts",
  "@@ -1 +1 @@", "-old", "+new", "Check this", "@@ -10 +10 @@", " context",
  "\\ No newline at end of file",
), Array.from({ length: 7 }, (_, i) => [i + 6, "one.ts", 2]));

check("files switch only after their own header", fenced(
  "--- a/one.ts", "+++ b/one.ts", "-one", "+two",
  "diff --git a/two.ts b/two.ts", "--- a/two.ts", "+++ b/two.ts", "+three",
), [[4, "one.ts", 2], [5, "one.ts", 2], [9, "two.ts", 6]]);

check("adjacent header-only files have separate jump targets", fenced(
  "diff --git a/one.ts b/one.ts", "old mode 100644", "new mode 100755",
  "diff --git a/two.ts b/two.ts", "--- a/two.ts", "+++ b/two.ts", "+two",
), [[8, "two.ts", 5]]);

check("adjacent plain header pairs have separate jump targets", fenced(
  "--- a/one.ts", "+++ b/one.ts", "--- a/two.ts", "+++ b/two.ts", "+two",
), [[6, "two.ts", 4]]);

check("rename uses the destination path", fenced(
  "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
  "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "+new",
), [[8, "new.ts", 2], [9, "new.ts", 2]]);

check("rename-only headers do not need a bar", fenced(
  "diff --git a/old.ts b/new.ts", "similarity index 100%", "rename from old.ts", "rename to new.ts",
), []);

check("deleted files use the old path", fenced(
  "diff --git a/gone.ts b/gone.ts", "deleted file mode 100644", "--- a/gone.ts", "+++ /dev/null", "-gone",
), [[6, "gone.ts", 2]]);

check("new files use the new path", fenced("--- /dev/null", "+++ b/new.ts", "+new"), [[4, "new.ts", 2]]);
check("unnamed diffs have no bar", fenced("@@ -1 +1 @@", "-old", "+new"), []);
check("unnamed headers have no bar", fenced("--- /dev/null", "+++ /dev/null", "+new"), []);

check("fence and prose boundaries reset the file", [
  fenced("--- a/one.ts", "+++ b/one.ts", "+one"), "Prose",
  fenced("@@ -1 +1 @@", "+unnamed"), fenced("--- a/one.ts", "+++ b/one.ts", "+one again"),
].join("\n"), [[4, "one.ts", 2], [14, "one.ts", 12]]);

check("non-diff code never gets a filename", "```ts\n--- a/a.ts\n+++ b/a.ts\n+code\n```", []);
check("empty document", "", []);
check("unclosed patch fence", "~~~patch\n--- a/a.ts\n+++ b/a.ts\n+code", [[4, "a.ts", 2]]);

const longName = "src/" + "nested/".repeat(20) + "<details>&settings.ts";
const source = fenced(`--- a/${longName}`, `+++ b/${longName}`, "+code");
check("long paths and markup remain plain text", source, [[4, longName, 2]]);
check("inserted prose shifts the jump target", "Preface\n\n" + source, [[6, longName, 4]]);
check("renaming a header rebuilds the filename", source.replace(`+++ b/${longName}`, "+++ b/renamed.ts"), [[4, "renamed.ts", 2]]);
check("removing headers clears the index", fenced("+code"), []);

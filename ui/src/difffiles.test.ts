import assert from "node:assert/strict";

import { readReview } from "../../src/diff.ts";
import { fileAt, neighbourFile, reviewFileIndex, reviewFiles } from "./difffiles.ts";

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

function summaries(name: string, source: string, expected: Array<[string, number, number, number]>) {
  const { list } = reviewFileIndex(readReview(source));
  assert.deepEqual(list.map(file => [file.name, file.header, file.added, file.removed]), expected, name);
  console.log(`ok   ${name}`);
}

summaries("counts additions and deletions, not headers, context or comments", fenced(
  "diff --git a/one.ts b/one.ts", "index 111..222 100644", "--- a/one.ts", "+++ b/one.ts",
  "@@ -1,3 +1,4 @@", "-old", "+new", "+extra", " context", "A human comment",
  "\\ No newline at end of file", "@@ -10 +11 @@", "-before", "+after",
), [["one.ts", 2, 3, 2]]);

summaries("header-only, rename-only and binary files remain jump targets", fenced(
  "diff --git a/mode.sh b/mode.sh", "old mode 100644", "new mode 100755",
  "diff --git a/old.ts b/new.ts", "similarity index 100%", "rename from old.ts", "rename to new.ts",
  "diff --git a/image.png b/image.png", "Binary files a/image.png and b/image.png differ",
), [["mode.sh", 2, 0, 0], ["new.ts", 5, 0, 0], ["image.png", 9, 0, 0]]);

summaries("new and deleted files use their surviving paths", fenced(
  "--- /dev/null", "+++ b/new.ts", "+one", "+two",
  "--- a/gone.ts", "+++ /dev/null", "-gone",
), [["new.ts", 2, 2, 0], ["gone.ts", 6, 0, 1]]);

summaries("renamed file counts use the final name and first header", fenced(
  "diff --git a/old.ts b/new.ts", "--- a/old.ts", "+++ b/new.ts", "-old", "+new",
), [["new.ts", 2, 1, 1]]);

summaries("adjacent header pairs remain distinct", fenced(
  "--- a/one.ts", "+++ b/one.ts", "--- a/two.ts", "+++ b/two.ts", "+two",
), [["one.ts", 2, 0, 0], ["two.ts", 4, 1, 0]]);

const repeated = [
  fenced("--- a/one.ts", "+++ b/one.ts", "+one"), "Prose",
  fenced("--- a/two.ts", "+++ b/two.ts", "-two"),
  fenced("--- a/one.ts", "+++ b/one.ts", "+again", "-before"),
].join("\n");
summaries("repeated filenames aggregate counts and retain their first jump target", repeated,
  [["one.ts", 2, 2, 1], ["two.ts", 8, 0, 1]]);
assert.equal(reviewFileIndex(readReview(repeated)).at.get(15)?.header, 13);

summaries("unnamed and non-diff blocks do not inflate counts", [
  fenced("--- a/one.ts", "+++ b/one.ts", "+one"),
  fenced("@@ -1 +1 @@", "-old", "+new"), "```ts\n+not a diff\n```",
].join("\n"), [["one.ts", 2, 1, 0]]);
summaries("empty reviews have no files", "", []);
summaries("long names and markup remain literal", source, [[longName, 2, 1, 0]]);
summaries("insertions shift summary jump targets", "Preface\n\n" + source, [[longName, 4, 1, 0]]);
summaries("edited headers replace the summary name", source.replace(`+++ b/${longName}`, "+++ b/renamed.ts"),
  [["renamed.ts", 2, 1, 0]]);
summaries("edited diff markers update counts", source.replace("+code", "-code"), [[longName, 2, 0, 1]]);
summaries("removing headers removes summary entries", fenced("+code"), []);

function heads(name: string, source: string, expected: Array<[number, string, number]>) {
  const { heads } = reviewFileIndex(readReview(source));
  assert.deepEqual([...heads].map(([line, file]) => [line, file.name, file.header]), expected, name);
  console.log(`ok   ${name}`);
}

heads("header lines keep the bar on their own file", fenced(
  "diff --git a/one.ts b/one.ts", "index 111..222 100644", "--- a/one.ts", "+++ b/one.ts", "+one",
  "diff --git a/two.ts b/two.ts", "--- a/two.ts", "+++ b/two.ts", "+two",
), [[2, "one.ts", 2], [3, "one.ts", 2], [4, "one.ts", 2], [5, "one.ts", 2],
  [7, "two.ts", 7], [8, "two.ts", 7], [9, "two.ts", 7]]);
heads("header-only files keep their header", fenced(
  "diff --git a/old.ts b/new.ts", "similarity index 100%", "rename from old.ts", "rename to new.ts",
), [[2, "new.ts", 2], [3, "new.ts", 2], [4, "new.ts", 2], [5, "new.ts", 2]]);
heads("unnamed headers stay unmapped", fenced("--- /dev/null", "+++ /dev/null", "+new"), []);
heads("hunk markers are not headers", fenced("--- a/one.ts", "+++ b/one.ts", "@@ -1 +1 @@", "+one"),
  [[2, "one.ts", 2], [3, "one.ts", 2]]);

const three = reviewFileIndex(readReview([
  "Before", fenced(
    "diff --git a/one.ts b/one.ts", "--- a/one.ts", "+++ b/one.ts", "+one", "+more",
    "diff --git a/two.ts b/two.ts", "--- a/two.ts", "+++ b/two.ts", "+two",
  ), "Between", fenced("--- a/three.ts", "+++ b/three.ts", "+three"),
].join("\n")));

function neighbour(name: string, line: number, direction: 1 | -1, expected: string | null) {
  assert.equal(neighbourFile(three, line, direction)?.name ?? null, expected, name);
  console.log(`ok   ${name}`);
}

neighbour("next file from prose before the diff is the first", 1, 1, "one.ts");
neighbour("next file from inside one file is the following one", 6, 1, "two.ts");
neighbour("next file crosses into a later diff block", 8, 1, "three.ts");
neighbour("no next file after the last header", 15, 1, null);
neighbour("previous file from inside a file is its own header", 6, -1, "one.ts");
neighbour("previous file from a header is the file before", 8, -1, "one.ts");
neighbour("previous file from the first header is none", 3, -1, null);
assert.equal(fileAt(three, 9)?.name, "two.ts");
assert.equal(fileAt(three, 10)?.name, "two.ts");
assert.equal(fileAt(three, 1), null);
console.log("ok   fileAt reads headers and bodies alike");

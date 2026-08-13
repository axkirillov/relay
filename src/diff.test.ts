import { commentReport, comments, readReview } from "./diff.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/** A document holding one diff block, written the way an agent would paste it. */
const doc = (...body: string[]) => ["Have a look:", "", "```diff", ...body, "```", ""].join("\n");

/** What each line of the block was read as, in order. */
const kinds = (text: string) => readReview(text).map((l) => l.kind);
/** Which line of the file each one is, as the count from the `@@` header makes it. */
const numbers = (text: string) => readReview(text).map((l) => l.number);

const patch = [
  "diff --git a/src/run.ts b/src/run.ts",
  "index 1234567..89abcde 100644",
  "--- a/src/run.ts",
  "+++ b/src/run.ts",
  "@@ -86,6 +86,7 @@ export function run(cmd) {",
  "   const child = spawn(cmd);",
  "-  return child;",
  "+  const timer = setTimeout(() => child.kill(), 5000);",
  "+  return child;",
  " }",
];

// --- what each line is -------------------------------------------------------
check("a git patch reads as a strip, a hunk and its body", kinds(doc(...patch)), [
  "file",
  "file",
  "file",
  "file",
  "hunk",
  "context",
  "del",
  "add",
  "add",
  "context",
]);

check(
  "the numbers are the file's, counted from the @@ header",
  numbers(doc(...patch)),
  [null, null, null, null, 86, 86, 87, 87, 88, 89],
);

check(
  "a patch with no `diff --git` above it still opens with a file strip",
  kinds(doc("--- src/run.ts", "+++ src/run.ts", "@@ -1,2 +1,2 @@", "-old", "+new")),
  ["file", "file", "hunk", "del", "add"],
);

check(
  "a rename is a file strip rather than four comments",
  kinds(
    doc(
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 98%",
      "rename from src/old.ts",
      "rename to src/new.ts",
    ),
  ),
  ["file", "file", "file", "file"],
);

check(
  "`\\ No newline at end of file` is a remark about the patch, not part of it",
  kinds(doc("@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file")),
  ["hunk", "del", "add", "nonewline"],
);

// --- the marker column decides -----------------------------------------------
check(
  "a line starting with none of the markers is the human's",
  kinds(doc("@@ -1,2 +1,2 @@", " kept", "+added", "why no timeout here?", " kept")),
  ["hunk", "context", "add", "comment", "context"],
);

check(
  "a comment is not a line of the file, and does not move the count",
  numbers(doc("@@ -10,3 +10,3 @@", " kept", "why no timeout here?", " kept")),
  [10, 10, null, 11],
);

check(
  "an empty line is the human's air around a comment, not a blank line of code",
  numbers(doc("@@ -10,3 +10,3 @@", " kept", "", "a remark", "", " kept")),
  [10, 10, null, null, null, 11],
);

// The trap the design accepts: a comment written as a bullet opens with `-`, so
// it paints red rather than yellow. Pinned here so it is changed on purpose.
check(
  "a comment written as a bullet reads as a deletion",
  kinds(doc("@@ -1,1 +1,1 @@", " kept", "- why no timeout here?")),
  ["hunk", "context", "del"],
);

// --- where a comment is ------------------------------------------------------
check(
  "a comment is located by the line above it",
  comments(doc(...patch, "why no timeout here?")),
  [{ file: "src/run.ts", line: 89, text: "why no timeout here?" }],
);

check(
  "a comment under a deletion points at the line the old one gave up",
  comments(doc("--- a/x.ts", "+++ b/x.ts", "@@ -40,2 +40,1 @@", "-  gone();", "this was load-bearing")),
  [{ file: "x.ts", line: 40, text: "this was load-bearing" }],
);

check(
  "a comment straight under the @@ header belongs to the hunk's first line",
  comments(doc("--- a/x.ts", "+++ b/x.ts", "@@ -12,2 +12,2 @@", "the whole hunk is wrong")),
  [{ file: "x.ts", line: 12, text: "the whole hunk is wrong" }],
);

check(
  "each comment is located in the file its own hunk is in",
  comments(
    doc(
      "diff --git a/src/run.ts b/src/run.ts",
      "--- a/src/run.ts",
      "+++ b/src/run.ts",
      "@@ -1,1 +1,1 @@",
      "+one",
      "first",
      "diff --git a/ui/src/main.ts b/ui/src/main.ts",
      "--- a/ui/src/main.ts",
      "+++ b/ui/src/main.ts",
      "@@ -140,1 +142,1 @@",
      "+two",
      "second",
    ),
  ),
  [
    { file: "src/run.ts", line: 1, text: "first" },
    { file: "ui/src/main.ts", line: 142, text: "second" },
  ],
);

check(
  "a new file is named by its `+++`, a deleted one by its `---`",
  comments(
    doc(
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,1 @@",
      "+one",
      "born here",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1,1 +0,0 @@",
      "-one",
      "died here",
    ),
  ),
  [
    { file: "src/new.ts", line: 1, text: "born here" },
    { file: "src/gone.ts", line: 1, text: "died here" },
  ],
);

// --- which blocks are reviews ------------------------------------------------
check("prose is not a review", readReview("Just a paragraph.\n\n- a bullet\n"), []);

check(
  "a fence in another language is not a review",
  readReview(["```ts", "const x = 1;", "```"].join("\n")),
  [],
);

check(
  "a diff a command printed is output, not a review",
  readReview(
    ["````output", "```diff", "@@ -1,1 +1,1 @@", "+one", "```", "````"].join("\n"),
  ),
  [],
);

check(
  "the document's own line numbers come back",
  readReview(doc("@@ -1,1 +1,1 @@", "+one")).map((l) => l.line),
  [4, 5],
);

// --- what the agent is handed ------------------------------------------------
check(
  "the report locates every comment under the diff",
  commentReport(
    doc(
      "--- a/src/run.ts",
      "+++ b/src/run.ts",
      "@@ -86,2 +86,2 @@",
      "+  return child;",
      "why is there no timeout here?",
      " }",
      "and it leaks the handle  ",
    ),
  ),
  "\n# comments left in the diff\nsrc/run.ts:86  why is there no timeout here?\nsrc/run.ts:87  and it leaks the handle\n",
);

check("a review with nothing said adds nothing", commentReport(doc(...patch)), "");

check("a document with no diff in it adds nothing", commentReport("Just prose.\n"), "");

process.exit(fails ? 1 : 0);

import { Text } from "@codemirror/state";
import { type Tag, tags as t } from "@lezer/highlight";

import { readReview } from "../../src/diff.ts";
import { diffPaint, markerClass } from "./diffcode.ts";
import { highlightStyle } from "./theme.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/**
 * What each role is called here, named by the style itself.
 *
 * The same trick as languages.test.ts, for the same reason: the classes a
 * HighlightStyle generates are opaque, so what a keyword looks like is whatever
 * class it gives `t.keyword` — and these assertions are written against the real
 * rules in theme.ts rather than a second copy of them.
 */
const roles: Array<[string, Tag]> = [
  ["keyword", t.keyword],
  ["string", t.string],
  ["number", t.number],
  ["comment", t.comment],
  ["type", t.typeName],
  ["fn", t.propertyName],
  ["builtin", t.standard(t.variableName)],
  ["name", t.variableName],
  ["punct", t.punctuation],
];

const named = new Map<string, string>([[markerClass, "marker"]]);
for (const [role, tag] of roles) {
  const cls = highlightStyle.style([tag]);
  if (cls && !named.has(cls)) named.set(cls, role);
}

/** A document holding one diff block, written the way an agent would paste it. */
const doc = (info: string, ...body: string[]) =>
  ["Have a look:", "", "```" + info, ...body, "```", ""].join("\n");

/** Everything painted in a document, as [text, role], in document order. */
function painted(text: string, first = 1, last = Number.MAX_SAFE_INTEGER): Array<[string, string]> {
  const line = Text.of(text.split("\n"));
  const at = new Map(readReview(text).map((l) => [l.line, l]));
  const paint = diffPaint(line, at, first, Math.min(last, line.lines));
  return paint
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map(({ from, to, cls }): [string, string] => [text.slice(from, to), named.get(cls) ?? cls]);
}

/** Just what a given stretch of text was painted as, however often. */
const rolesOf = (text: string, word: string) => painted(text).filter(([had]) => had === word).map(([, r]) => r);

const php = doc(
  "diff",
  "--- a/src/Order.php",
  "+++ b/src/Order.php",
  "@@ -10,4 +10,4 @@ class Order",
  "     public function total(): int",
  "     {",
  "-        return $this->old;",
  "+        return $this->sum; // fixed",
  "     }",
);

// --- the code is the code of its own language --------------------------------
check("php: the hunk is php, line by line", painted(php), [
  ["public", "keyword"],
  ["function", "keyword"],
  ["total", "name"],
  ["(", "punct"],
  [")", "punct"],
  [":", "punct"],
  ["int", "type"],
  ["{", "punct"],
  ["-", "marker"],
  ["return", "keyword"],
  ["$this", "fn"],
  ["->", "punct"],
  ["old", "fn"],
  [";", "punct"],
  ["+", "marker"],
  ["return", "keyword"],
  ["$this", "fn"],
  ["->", "punct"],
  ["sum", "fn"],
  [";", "punct"],
  ["// fixed", "comment"],
  ["}", "punct"],
]);

// A deletion is not in the new side at all, so its colours can only have come
// from the old one — which is the whole reason two texts are parsed.
check("the old side is what paints a deletion", rolesOf(php, "return"), ["keyword", "keyword"]);

// --- the marker column -------------------------------------------------------
check("the marker is painted, once, and only where it is a glyph", painted(php).filter(([, r]) => r === "marker"), [
  ["-", "marker"],
  ["+", "marker"],
]);
check(
  "a context line's space is not decorated",
  painted(doc("diff", "@@ -1,2 +1,2 @@", " kept", "+new")).filter(([, r]) => r === "marker").length,
  1,
);

// --- a context line is painted once, not once per side ------------------------
// Both sides are parsed and both contain it; only the new side keeps it. Painted
// twice, one word would carry two spans out of two parses that need not agree.
check("a context line is painted once", rolesOf(php, "public"), ["keyword"]);

// --- where the language comes from -------------------------------------------
check(
  "the file headers say what the language is",
  painted(doc("diff", "--- a/x.ts", "+++ b/x.ts", "@@ -1,1 +1,1 @@", "+const a = 1;")),
  [
    ["+", "marker"],
    ["const", "keyword"],
    ["a", "name"],
    ["=", "punct"],
    ["1", "number"],
    [";", "punct"],
  ],
);
check(
  "each file of a patch is read as itself",
  painted(
    doc(
      "diff",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "+const a = 1;",
      "--- a/b.py",
      "+++ b/b.py",
      "@@ -1,1 +1,1 @@",
      "+a = 'hi'",
    ),
  ).filter(([, r]) => r === "string" || r === "keyword"),
  [
    ["const", "keyword"],
    ["'hi'", "string"],
  ],
);
// The fence's second word, for a fragment that never named a file.
check("the fence answers where there are no headers", painted(doc("diff php", "@@ -1,1 +1,1 @@", "+$a = null;")), [
  ["+", "marker"],
  ["$a", "name"],
  ["=", "punct"],
  ["null", "number"],
  [";", "punct"],
]);
check(
  "the headers win over the fence",
  painted(doc("diff php", "--- a/x.ts", "+++ b/x.ts", "@@ -1,1 +1,1 @@", "+const a = 1;")).some(
    ([had, r]) => had === "const" && r === "keyword",
  ),
  true,
);
// Nothing known about the language leaves the washes and the numbers to say it
// all, which is what the block looked like before any of this.
check("no language, no colours", painted(doc("diff", "@@ -1,1 +1,1 @@", "+whatever this is")), [
  ["+", "marker"],
]);
check(
  "a file whose extension we have no language for",
  painted(doc("diff php", "--- a/x.twig", "+++ b/x.twig", "@@ -1,1 +1,1 @@", "+{{ name }}")),
  [["+", "marker"]],
);

// --- what a hunk is ----------------------------------------------------------
// Each hunk is parsed alone: laid end to end, two hunks are not source, and a
// comment opened in one would swallow the next.
const spanning = doc(
  "diff",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -1,1 +1,1 @@",
  "+/* opened and never closed",
  "@@ -90,1 +90,1 @@",
  "+const a = 1;",
);
check("a hunk is parsed alone", rolesOf(spanning, "const"), ["keyword"]);
check("the unclosed comment stays in its own hunk", rolesOf(spanning, "/* opened and never closed"), ["comment"]);

// The human's own line is not code and does not break the code around it.
const commented = doc(
  "diff",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -1,3 +1,3 @@",
  "+const a = 1;",
  "why not two?",
  "+const b = 2;",
);
check("a comment is not painted", painted(commented).some(([had]) => had.includes("why")), false);
check("a comment does not end the hunk", rolesOf(commented, "const"), ["keyword", "keyword"]);

// --- what is not a diff ------------------------------------------------------
check("a fence in another language is not painted", painted("```ts\nconst a = 1;\n```\n"), []);
check("prose is not painted", painted("Just a paragraph.\n\n- a bullet\n"), []);

// --- the viewport ------------------------------------------------------------
// Painting is bounded by the lines asked for, and a hunk reaching into them is
// painted whole — half a hunk is a different fragment, and would come back a
// different colour as it scrolled.
const tall = ["prose", "", "```diff", "--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +1,2 @@", "+const a = 1;", "+const b = 2;", "```", ""].join("\n");
check("nothing is painted above the viewport", painted(tall, 9, 10), []);
check(
  "a hunk the viewport reaches into is painted whole",
  painted(tall, 8, 8).filter(([, r]) => r === "keyword"),
  [
    ["const", "keyword"],
    ["const", "keyword"],
  ],
);

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);

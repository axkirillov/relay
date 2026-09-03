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

const doc = (info: string, ...body: string[]) =>
  ["Have a look:", "", "```" + info, ...body, "```", ""].join("\n");

function painted(text: string, first = 1, last = Number.MAX_SAFE_INTEGER): Array<[string, string]> {
  const line = Text.of(text.split("\n"));
  const at = new Map(readReview(text).map((l) => [l.line, l]));
  const paint = diffPaint(line, at, first, Math.min(last, line.lines));
  return paint
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map(({ from, to, cls }): [string, string] => [text.slice(from, to), named.get(cls) ?? cls]);
}

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

check("the old side is what paints a deletion", rolesOf(php, "return"), ["keyword", "keyword"]);

check("the marker is painted, once, and only where it is a glyph", painted(php).filter(([, r]) => r === "marker"), [
  ["-", "marker"],
  ["+", "marker"],
]);
check(
  "a context line's space is not decorated",
  painted(doc("diff", "@@ -1,2 +1,2 @@", " kept", "+new")).filter(([, r]) => r === "marker").length,
  1,
);

check("a context line is painted once", rolesOf(php, "public"), ["keyword"]);

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
check("no language, no colours", painted(doc("diff", "@@ -1,1 +1,1 @@", "+whatever this is")), [
  ["+", "marker"],
]);
check(
  "a file whose extension we have no language for",
  painted(doc("diff php", "--- a/x.twig", "+++ b/x.twig", "@@ -1,1 +1,1 @@", "+{{ name }}")),
  [["+", "marker"]],
);

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

check("a fence in another language is not painted", painted("```ts\nconst a = 1;\n```\n"), []);
check("prose is not painted", painted("Just a paragraph.\n\n- a bullet\n"), []);

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

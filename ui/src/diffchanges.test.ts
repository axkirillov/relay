import assert from "node:assert/strict";

import { readReview } from "../../src/diff.ts";
import { changedSpans } from "./diffchanges.ts";

const doc = (...lines: string[]) => ["```diff ts", ...lines, "```"].join("\n");
function marked(text: string): Array<[string, string[]]> {
  const lines = readReview(text);
  const spans = changedSpans(lines);
  return lines.filter(line => spans.has(line.line)).map(line => [
    line.text,
    spans.get(line.line)!.map(({ from, to }) => {
      assert.ok(from >= 1 && to > from && to <= line.text.length);
      return line.text.slice(from, to);
    }),
  ]);
}
function check(name: string, text: string, expected: Array<[string, string[]]>) {
  assert.deepEqual(marked(text), expected, name);
  console.log(`ok   ${name}`);
}

check("numbers, whole identifiers and operators", doc(
  "-const timeout = 5000;", "+const timeout = 10000;",
  "-return oldName(value) <= limit;", "+return newName(value) < limit;",
), [
  ["-const timeout = 5000;", ["5000"]], ["+const timeout = 10000;", ["10000"]],
  ["-return oldName(value) <= limit;", ["oldName", "<="]],
  ["+return newName(value) < limit;", ["newName", "<"]],
]);
check("inserted words", doc("-return fetch(url);", "+return await fetch(url);"), [
  ["+return await fetch(url);", ["await "]],
]);
check("removed words", doc("-return await fetch(url);", "+return fetch(url);"), [
  ["-return await fetch(url);", ["await "]],
]);
check("uneven replacements align by shared content, not row index", doc(
  "-const first = 1;", "-const second = 2;",
  "+logStart();", "+const first = 10;", "+const second = 20;", "+logEnd();",
), [
  ["-const first = 1;", ["1"]], ["-const second = 2;", ["2"]],
  ["+const first = 10;", ["10"]], ["+const second = 20;", ["20"]],
]);
check("extra removed lines remain line-only", doc(
  "-logStart();", "-const first = 1;", "-logEnd();", "+const first = 10;",
), [["-const first = 1;", ["1"]], ["+const first = 10;", ["10"]]]);
check("unchanged lines anchor alignment", doc(
  "-const first = 1;", "-const second = 2;", "+const second = 2;",
), []);
check("pure additions and deletions", doc("+const added = 1;", " context", "-const deleted = 1;"), []);
check("identical lines", doc("-const same = 1;", "+const same = 1;"), []);
check("unrelated code with shared punctuation", doc("-foo();", "+bar();"), []);
check("unrelated code with a shared short word", doc(
  "-x = wonderfulOldFunction();", "+x = completelyDifferentFunction();",
), []);
check("unrelated prose", doc("-red apples yesterday", "+blue clouds tomorrow"), []);
check("punctuation-only replacements", doc("-([])", "+({})"), []);
check("punctuation changes in matching code", doc("-call(first, second);", "+call(first, second)!"), [
  ["-call(first, second);", [";"]], ["+call(first, second)!", ["!"]],
]);
check("operator changes keep the whole operator", doc("-if (a === b && ready) run();", "+if (a !== b || ready) run();"), [
  ["-if (a === b && ready) run();", ["===", "&&"]],
  ["+if (a !== b || ready) run();", ["!==", "||"]],
]);
check("whitespace changes remain visible", doc("-\treturn value;", "+  return value;"), [
  ["-\treturn value;", ["\t"]], ["+  return value;", ["  "]],
]);
check("whitespace-only lines remain line-only", doc("-  ", "+\t"), []);
check("empty replacements", doc("-", "+"), []);
check("trailing whitespace", doc("-return value; ", "+return value;"), [
  ["-return value; ", [" "]],
]);
check("Unicode identifiers, combining marks and astral characters", doc(
  "-const café = '🍎';", "+const café = '🍏';",
), [["-const café = '🍎';", ["café", "🍎"]], ["+const café = '🍏';", ["café", "🍏"]]]);
check("non-Latin words", doc("-const 名称 = oldValue;", "+const 名称 = newValue;"), [
  ["-const 名称 = oldValue;", ["oldValue"]], ["+const 名称 = newValue;", ["newValue"]],
]);
check("no-newline annotations do not break a replacement", doc(
  "-const value = 1;", "\\ No newline at end of file", "+const value = 2;", "\\ No newline at end of file",
), [["-const value = 1;", ["1"]], ["+const value = 2;", ["2"]]]);
for (const [name, separator] of [
  ["context", " unchanged"],
  ["hunk", "@@ -90 +90 @@"],
  ["file", "diff --git a/other.ts b/other.ts"],
  ["comment", "Why did this change?"],
  ["blank comment", ""],
  ["file headers", "--- a/other.ts\n+++ b/other.ts"],
  ["fence", "```\n```diff ts"],
  ["prose between fences", "```\nSome explanation.\n```diff ts"],
]) {
  check(`never compare across ${name}`, doc("-const value = 1;", separator, "+const value = 2;"), []);
}
check("multiple fences have independent offsets", `${doc("-const a = 1;", "+const a = 2;")}\n${doc("-let b = 3;", "+let b = 4;")}`, [
  ["-const a = 1;", ["1"]], ["+const a = 2;", ["2"]], ["-let b = 3;", ["3"]], ["+let b = 4;", ["4"]],
]);
check("non-diff fences and prose are ignored", "-const a = 1;\n+const a = 2;\n```ts\n-const b = 1;\n+const b = 2;\n```", []);
check("patch fences work too", "```patch\n-const a = 1;\n+const a = 2;\n```", [
  ["-const a = 1;", ["1"]], ["+const a = 2;", ["2"]],
]);
check("oversized runs fall back without losing later replacements", doc(
  ...Array.from({ length: 33 }, (_, i) => `-const value${i} = 1;`),
  ...Array.from({ length: 33 }, (_, i) => `+const value${i} = 2;`),
  " context", "-const last = 1;", "+const last = 2;",
), [["-const last = 1;", ["1"]], ["+const last = 2;", ["2"]]]);
check("oversized lines fall back", doc(`-const value = '${"a".repeat(2048)}';`, `+const value = '${"b".repeat(2048)}';`), []);
check("oversized run text falls back", doc(
  ...Array.from({ length: 20 }, () => `-const value = '${"a".repeat(500)}';`),
  ...Array.from({ length: 20 }, () => `+const value = '${"b".repeat(500)}';`),
), []);
check("token work is bounded", doc(`-return ${"a + ".repeat(480)}1;`, `+return ${"a + ".repeat(480)}2;`), []);
check("edit distance is bounded even with a long shared identifier", doc(
  `-return ${"x".repeat(700)}(${Array.from({ length: 70 }, (_, i) => `old${i}`).join(",")});`,
  `+return ${"x".repeat(700)}(${Array.from({ length: 70 }, (_, i) => `new${i}`).join(",")});`,
), []);
const repeated = Array.from({ length: 1000 }, () => doc(`-return ${"a + ".repeat(20)}1;`, `+return ${"a + ".repeat(20)}2;`)).join("\n");
const bounded = marked(repeated);
assert.ok(bounded.length > 0 && bounded.length < 2000);
assert.deepEqual(marked(repeated), bounded);
console.log("ok   document-wide work budget falls back deterministically");
console.log("all green");

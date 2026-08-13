import { fence, insertion, withoutPrompt } from "./take.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

// --- fence -------------------------------------------------------------------
check("fence: a command and its output", fence(["$ ls", "one", "two"]), "```console\n$ ls\none\ntwo\n```");
check("fence: the terminal's blank rows go", fence(["", "$ ls", "one", "", ""]), "```console\n$ ls\none\n```");
check("fence: trailing spaces go", fence(["$ ls   ", "one\t"]), "```console\n$ ls\none\n```");
check("fence: nothing but blank rows", fence(["", "  ", ""]), null);
check("fence: no rows at all", fence([]), null);
// Output that quotes a fence would otherwise end the block early.
check("fence: output holds a fence", fence(["$ cat r.md", "```sh", "ls", "```"]),
  "````console\n$ cat r.md\n```sh\nls\n```\n````");
check("fence: output holds a longer fence", fence(["````", "x"]), "`````console\n````\nx\n`````");
check("fence: inline backticks are not a fence", fence(["use `ls`"]), "```console\nuse `ls`\n```");

// --- withoutPrompt -----------------------------------------------------------
// A two-line prompt: the path above it is drawn again under the output, and only
// the `❯` line itself was obviously not part of what ran.
check("prompt: two lines, the upper one comes back",
  withoutPrompt(["❯ node --version", "v24.14.1", "~/repos/relay"], ["", "~/repos/relay"]),
  ["❯ node --version", "v24.14.1"]);
check("prompt: three lines",
  withoutPrompt(["❯ ls", "one", "", "~/repos/relay", "main +1"], ["", "~/repos/relay", "main +1"]),
  ["❯ ls", "one", ""]);
// A one-line prompt leaves nothing behind, and what stood above the command was
// the last command's output — which must not be mistaken for a prompt.
check("prompt: one line, nothing to drop",
  withoutPrompt(["$ ls", "one", "two"], ["$ echo hi", "hi"]),
  ["$ ls", "one", "two"]);
check("prompt: blank lines match nothing",
  withoutPrompt(["$ ls", "one", ""], ["", ""]),
  ["$ ls", "one", ""]);
check("prompt: a cd changed it, so it stays",
  withoutPrompt(["❯ cd ..", "~/repos"], ["", "~/repos/relay"]),
  ["❯ cd ..", "~/repos"]);
check("prompt: output shorter than the prompt", withoutPrompt(["~/x"], ["a", "~/x"]), []);

// --- insertion ---------------------------------------------------------------
const B = "```console\nout\n```";

/** The document after taking a block, with the caret marked as ‸. */
function into(doc: string, pos: number) {
  const { from, insert } = insertion(doc, pos, B);
  const after = doc.slice(0, from) + insert + doc.slice(from);
  return after.slice(0, from + insert.length) + "‸" + after.slice(from + insert.length);
}

check("into: after the caret's line", into("a\nb\n", 0), `a\n\n${B}\n‸\nb\n`);
check("into: never mid-line", into("hello there\n", 5), `hello there\n\n${B}‸\n`);
check("into: the blank line already there is enough", into("a\n\nb\n", 2), `a\n\n${B}\n‸\nb\n`);
// No blank line is added below a block with nothing under it.
check("into: end of the document", into("a\nb\n", 3), `a\nb\n\n${B}‸\n`);
check("into: a document with no trailing newline", into("a", 1), `a\n\n${B}\n‸`);
check("into: an empty document", into("", 0), `${B}\n‸`);
check("into: past the end clamps", into("a\n", 99), `a\n\n${B}\n‸`);

// Two takes in a row stack in the order they were taken, because the caret ends
// up under the first one.
{
  const first = insertion("a\nb\n", 0, "ONE");
  const doc = "a\nb\n".slice(0, first.from) + first.insert + "a\nb\n".slice(first.from);
  const at = first.from + first.insert.length;
  const second = insertion(doc, at, "TWO");
  check("into: stacked takes keep their order",
    doc.slice(0, second.from) + second.insert + doc.slice(second.from),
    "a\n\nONE\n\nTWO\n\nb\n");
}

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);

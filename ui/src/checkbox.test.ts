import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import { boxAt, boxes, neighbourBox, toggle } from "./checkbox.ts";
import { codeLanguage } from "./languages.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function stateOf(doc: string) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, codeLanguages: codeLanguage })],
  });
}

function toggled(marked: string): string | null {
  const pos = marked.indexOf("|");
  const doc = marked.replace("|", "");
  const box = boxAt(stateOf(doc), pos);
  if (!box) return null;
  const c = toggle(box);
  return doc.slice(0, c.from) + c.insert + doc.slice(c.to);
}

check("ticks an empty box", toggled("- [ ] li|nt"), "- [x] lint");
check("unticks a ticked box", toggled("- [x] |lint"), "- [ ] lint");
check("unticks a capital X", toggled("|- [X] lint"), "- [ ] lint");
check("works at the end of the line", toggled("- [ ] lint|"), "- [x] lint");
check("works nested", toggled("- a\n  - [ ] b|"), "- a\n  - [x] b");
check("works in an ordered list", toggled("1. [ ] b|"), "1. [x] b");
check("only the cursor's line", toggled("- [ ] a\n- [ ] b|"), "- [ ] a\n- [x] b");
check("no box on a plain item", toggled("- lint|"), null);
check("no box in prose", toggled("see [ ] here|"), null);
check("no box in a code fence", toggled("```\n- [ ] a|\n```"), null);
check("finds every box", boxes(stateOf("- [ ] a\n- [x] b\n\n```\n- [ ] c\n```")).map((b) => b.ticked), [false, true]);

{
  const doc = "intro\n- [ ] a\n- [x] b\n\n```\n- [ ] c\n```\n";
  const state = stateOf(doc);
  const inA = doc.indexOf("[ ] a") + 1;
  const inB = doc.indexOf("[x] b") + 1;
  check("]x from the top lands inside the first box", neighbourBox(state, 0, 1), inA);
  check("]x from a box goes to the next, ticked or not", neighbourBox(state, inA, 1), inB);
  check("]x past the last box finds nothing", neighbourBox(state, inB, 1), null);
  check("[x from a box goes to the one before", neighbourBox(state, inB, -1), inA);
  check("[x before the first box finds nothing", neighbourBox(state, inA, -1), null);
  check("[x from the end lands on the last box", neighbourBox(state, doc.length, -1), inB);
}

if (fails) process.exit(1);

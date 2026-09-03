import { EditorState } from "@codemirror/state";
import { originalSpan, restore } from "./restore.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function fakeView(doc: string) {
  const v = {
    state: EditorState.create({ doc }),
    dispatch(spec: any) {
      v.state = v.state.update(spec).state;
    },
  };
  return v as any;
}

function res(original: string, current: string, a: number, b = a) {
  const v = fakeView(current);
  const n = restore(v, original, a, b);
  return { n, doc: v.state.doc.toString() };
}

const abc = "a\nb\nc\n";

check("span: unchanged, line 1", originalSpan(abc, abc, 1, 1), { from: 1, to: 2 });
check("span: deleted b, cursor on c", originalSpan(abc, "a\nc\n", 1, 1), { from: 1, to: 3 });
check("span: deleted b, cursor on a", originalSpan(abc, "a\nc\n", 0, 0), { from: 0, to: 2 });
check("span: deleted b and c, cursor on a", originalSpan(abc, "a\n", 0, 0), { from: 0, to: 3 });
check("span: deleted a, cursor on b", originalSpan(abc, "b\nc\n", 0, 0), { from: 0, to: 2 });
check("span: pure insertion", originalSpan("a\nb\n", "a\nX\nb\n", 1, 1), { from: 1, to: 1 });
check("span: edited line", originalSpan(abc, "a\nB!\nc\n", 1, 1), { from: 1, to: 2 });
check("span: whole doc", originalSpan(abc, "a\nc\n", 0, 1), { from: 0, to: 3 });
check("span: everything deleted", originalSpan(abc, "\n", 0, 0), { from: 0, to: 3 });

check("res: deleted b, from c", res(abc, "a\nc\n", 1), { n: true, doc: "a\nb\nc\n" });
check("res: deleted b, from a", res(abc, "a\nc\n", 0), { n: true, doc: "a\nb\nc\n" });
check("res: deleted last line", res(abc, "a\nb\n", 1), { n: true, doc: "a\nb\nc\n" });
check("res: deleted first line", res(abc, "b\nc\n", 0), { n: true, doc: "a\nb\nc\n" });
check("res: deleted two lines", res(abc, "a\n", 0), { n: true, doc: "a\nb\nc\n" });
check("res: edited line back", res(abc, "a\nB!\nc\n", 1), { n: true, doc: "a\nb\nc\n" });
check("res: whole doc back", res(abc, "totally different\n", 0), { n: true, doc: "a\nb\nc\n" });
check("res: unchanged line is a no-op", res(abc, abc, 1), { n: false, doc: abc });
check("res: inserted line goes away", res("a\nb\n", "a\nX\nb\n", 1), { n: true, doc: "a\nb\n" });
check("res: inserted last line goes away", res("a\nb\n", "a\nb\nX\n", 2), { n: true, doc: "a\nb\n" });
check("res: line range clamps past the end", res(abc, "a\n", 0, 99), { n: true, doc: "a\nb\nc\n" });
check("res: reversed range", res(abc, "a\nB!\nC!\n", 2, 1), { n: true, doc: "a\nb\nc\n" });

check("res: one line of two edited", res(abc, "a\nB!\nC!\n", 1), { n: true, doc: "a\nb\nC!\n" });

const para = "intro\none\ntwo\nthree\nouttro\n";

check("res: shrunken run, first line", res(para, "intro\nONE\nTWO\nouttro\n", 1),
  { n: true, doc: "intro\none\nTWO\nouttro\n" });
check("res: shrunken run, last line", res(para, "intro\nONE\nTWO\nouttro\n", 2),
  { n: true, doc: "intro\nONE\ntwo\nthree\nouttro\n" });
check("res: grown run, extra line", res(para, "intro\nONE\nTWO\nTHREE\nouttro\n", 3),
  { n: true, doc: "intro\nONE\nTWO\nthree\nouttro\n" });

check("res: two edits, touch one", res(para, "intro\nONE\ntwo\nouttro\n", 1),
  { n: true, doc: "intro\none\ntwo\nouttro\n" });

{
  const v = fakeView("a\nc\n");
  const first = restore(v, abc, 1, 1);
  const doc1 = v.state.doc.toString();
  const second = restore(v, abc, 1, 1);
  check("res: idempotent", { first, doc1, second, doc2: v.state.doc.toString() },
    { first: true, doc1: "a\nb\nc\n", second: false, doc2: "a\nb\nc\n" });
}

check("res: blank line", res(abc, "a\n\nc\n", 1), { n: true, doc: "a\nb\nc\n" });

check("res: empty original", res("", "typed something\n", 0), { n: true, doc: "" });

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);

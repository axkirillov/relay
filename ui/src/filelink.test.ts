import assert from "node:assert/strict";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { fileAt, fileReference } from "./filelink.ts";
import { contextAction } from "./footer.ts";

function state(marked: string) {
  const anchor = marked.indexOf("|");
  return EditorState.create({ doc: marked.replace("|", ""), selection: { anchor }, extensions: [markdown()] });
}
const at = (text: string) => fileAt(state(text));
assert.deepEqual(at("Read src/ma|in.ts:42:7, then continue."), { path: "src/main.ts", line: 42, column: 7 });
assert.deepEqual(at("Read [the |source](../src/main.ts#L12C3-L18)."), { path: "../src/main.ts", line: 12, column: 3 });
assert.deepEqual(at("Read [the source](../s|rc/main.ts#L12)."), { path: "../src/main.ts", line: 12 });
assert.deepEqual(at("`src/a b|';$(bad).ts:5`"), { path: "src/a b';$(bad).ts", line: 5 });
assert.deepEqual(at('"src/a |b.ts:8"'), { path: "src/a b.ts", line: 8 });
assert.deepEqual(at("[a| file](<../a b.ts>:4)"), null);
assert.deepEqual(at("[a| file](<../a b.ts:4>)"), { path: "../a b.ts", line: 4 });
assert.deepEqual(at("[a| file](../a%20b.ts#L7)"), { path: "../a b.ts", line: 7 });
assert.deepEqual(at("[a| file](src/thing(test).ts)"), { path: "src/thing(test).ts" });
assert.deepEqual(at("[la|bel][REF]\n\n[ref]: ../main.ts:4\n"), { path: "../main.ts", line: 4 });
assert.deepEqual(at("[re|f][]\n\n[ref]: ../main.ts\n"), { path: "../main.ts" });
assert.deepEqual(at("[re|f]\n\n[ref]: ../main.ts\n"), { path: "../main.ts" });
assert.deepEqual(at("|README"), { path: "README" });
assert.equal(at("look | here.ts"), null);
assert.equal(at("[w|eb](https://example.com/test.ts)"), null);
assert.equal(at("|https://example.com/test.ts"), null);
assert.deepEqual(fileReference("file:///tmp/a%20b.ts#L2"), { path: "/tmp/a b.ts", line: 2 });
assert.deepEqual(fileReference("100% done.ts"), { path: "100% done.ts" });
assert.equal(fileReference("bad%thing.ts", true), null);
for (const value of ["", "javascript:alert(1)", "ssh://server/file", "file://server/file", "www.example.com", "#title", "//server/file", "a\nfile", "a.ts:999999999999999999999"]) assert.equal(fileReference(value), null, value);
const selected = EditorState.create({ doc: "a path.ts:12", selection: { anchor: 0, head: 12 }, extensions: [markdown()] });
assert.deepEqual(fileAt(selected), { path: "a path.ts", line: 12 });
assert.deepEqual(contextAction(state("Read `src/m|ain.ts:2`"), "normal", false, true), { kind: "file", key: "gf", label: "Edit file" });
assert.equal(contextAction(state("|Some prose"), "normal", false, true).kind, "edit");
assert.equal(contextAction(state("|src/main.ts"), "insert", false, true).kind, "normal");
assert.equal(contextAction(state("|src/main.ts"), "normal", true, true).kind, "file");
assert.equal(contextAction(state("|src/main.ts"), "normal", false, false).kind, "edit");
console.log("ok file references, Markdown destinations, positions, selection and gf hints");

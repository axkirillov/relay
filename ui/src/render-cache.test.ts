import assert from "node:assert/strict";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Diagrams } from "./diagram.ts";
import { renderBlocks, setRendering } from "./render.ts";

const table = "| Item | State |\n| --- | --- |\n| Check | waiting |";
const code = "graph TD\nA --> B";
const diagram = `\`\`\`mermaid\n${code}\n\`\`\``;
const original = `Opening paragraph\n\n${table}\n\n<p>Kept HTML</p>\n\n![icon](icon.png)\n\n${diagram}\n\nEnd\n`;
const diagrams: Diagrams = new Map([[code, { error: "Parse error on line 2: invalid edge" }]]);
const make = (doc: string, source = original, drawings = diagrams) => EditorState.create({
  doc,
  extensions: [markdown({ base: markdownLanguage }), renderBlocks(source, {}, drawings)],
});
const decorations = (state: EditorState) => state.facet(EditorView.decorations).flatMap(set => {
  if (typeof set === "function") return [];
  const ranges: unknown[] = [];
  set.between(0, state.doc.length, (from, to, decoration) => {
    const widget = decoration.spec.widget;
    ranges.push({ from, to, html: widget?.html, text: widget?.text });
  });
  return ranges;
});

let state = make(original);
const includes = String.prototype.includes;
let searches = 0;
String.prototype.includes = function (text: string, position?: number): boolean {
  if (this.toString() === original) searches++;
  return includes.call(this, text, position);
};
try {
  const tree = syntaxTree(state);
  const iterate = tree.iterate;
  let walks = 0;
  tree.iterate = function (spec) { walks++; return iterate.call(this, spec); };
  try {
    for (let anchor = 1; anchor < 15; anchor++) state = state.update({ selection: { anchor } }).state;
    assert.equal(walks, 0, "cursor movement does not walk the syntax tree again");
    assert.equal(searches, 0, "cursor movement does not search the original document");
  } finally {
    tree.iterate = iterate;
  }

  state = state.update({ changes: { from: 0, insert: "New opening\n" } }).state;
  assert.equal(searches, 0, "prose edits reuse matches for unchanged blocks");
  const at = state.doc.toString().indexOf("waiting");
  state = state.update({ changes: { from: at, to: at + 7, insert: "changed" } }).state;
  assert.equal(searches, 1, "an edited table gets a fresh original-text check");
  assert.ok(!JSON.stringify(decorations(state)).includes("<table>"), "edited blocks stay as source");
  state = state.update({ changes: { from: 0, insert: "More prose\n" } }).state;
  assert.equal(searches, 1, "negative matches are cached too");

  const edited = table.replace("waiting", "changed");
  const start = state.doc.toString().indexOf(edited);
  state = state.update({ changes: { from: start, to: start + edited.length } }).state;
  const afterDeletion = searches;
  state = state.update({ changes: { from: start, insert: edited } }).state;
  assert.equal(searches, afterDeletion + 1, "deleted text leaves the cache rather than accumulating every edited version");

  state = state.update({ effects: setRendering.of(false) }).state;
  assert.deepEqual(decorations(state), []);
  const beforeRaw = searches;
  state = state.update({ changes: { from: 0, insert: "raw edit\n" }, selection: { anchor: 3 } }).state;
  assert.equal(searches, beforeRaw, "raw-mode edits do not build render candidates");
  state = state.update({ effects: setRendering.of(true) }).state;
  assert.ok(decorations(state).length > 0, "returning to rendered mode indexes the current document");
} finally {
  String.prototype.includes = includes;
}

function equivalent(spec: TransactionSpec) {
  state = state.update(spec).state;
  const fresh = make(state.doc.toString()).update({ selection: state.selection, filter: false }).state;
  assert.deepEqual(decorations(state), decorations(fresh), "incremental decorations match a fresh state");
}
state = make(original);
for (const anchor of [original.indexOf("Item"), 1, original.indexOf("HTML"), original.indexOf("icon"), original.length - 1]) {
  equivalent({ selection: { anchor } });
}
equivalent({ changes: { from: 0, insert: "Preface\n\n" } });
const tableAt = state.doc.toString().indexOf(table);
equivalent({ changes: { from: tableAt, to: tableAt + table.length, insert: table.replace("waiting", "done") } });
equivalent({ changes: { from: tableAt, to: tableAt + table.length - 3, insert: table } });
equivalent({ selection: { anchor: 0, head: state.doc.length } });
equivalent({ selection: { anchor: state.doc.length } });
equivalent({ changes: { from: 0, to: state.doc.length, insert: original } });

const stepping = `Above\n\n${table}\n\nBelow`;
let stepped = make(stepping, stepping);
stepped = stepped.update({ selection: { anchor: stepped.doc.line(2).from } }).state;
stepped = stepped.update({ selection: { anchor: stepped.doc.line(6).from } }).state;
assert.equal(stepped.selection.main.head, stepped.doc.line(3).from, "walking down enters the first table line");
stepped = stepped.update({ selection: { anchor: stepped.doc.line(6).from }, filter: false }).state;
stepped = stepped.update({ selection: { anchor: stepped.doc.line(2).from } }).state;
assert.equal(stepped.selection.main.head, stepped.doc.line(5).from, "walking up enters the last table line");
stepped = stepped.update({ effects: setRendering.of(false), selection: { anchor: stepped.doc.line(2).from }, filter: false }).state;
stepped = stepped.update({ selection: { anchor: stepped.doc.line(6).from } }).state;
assert.equal(stepped.selection.main.head, stepped.doc.line(6).from, "raw navigation is not intercepted");

const many = `Start\n\n${Array.from({ length: 2000 }, (_, i) => table.replace("Item", `Item ${i}`)).join("\n\n")}\n`;
let partial = make(many, many, new Map());
const firstCount = decorations(partial).length;
assert.ok(firstCount < 2000, "the parser fixture begins with a partial tree");
assert.ok(ensureSyntaxTree(partial, partial.doc.length, 10000));
partial = partial.update({}).state;
assert.equal(decorations(partial).length, 2000, "background parsing invalidates candidates even without a document edit");

const shared = renderBlocks(original, {}, diagrams);
const one = EditorState.create({ doc: original, extensions: [markdown({ base: markdownLanguage }), shared] });
const two = EditorState.create({ doc: "Different document", extensions: [markdown({ base: markdownLanguage }), shared] });
assert.deepEqual(decorations(two), []);
assert.ok(decorations(one).length > 0, "sharing an extension does not share mutable document caches");

console.log("ok   render caches preserve selection, edits, raw mode, parsing progress and document isolation, and release removed block text");

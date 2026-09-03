import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { spillPath } from "../../src/spill";
import { isRendering } from "./render";
import { outputInfo } from "./runblock";

export const tailLines = 20;

const worthFolding = tailLines + 3;

type SyntaxNode = {
  name: string;
  from: number;
  to: number;
  firstChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
};

class Earlier extends WidgetType {
  lines: number;
  at: number;
  path: string | null;
  constructor(lines: number, at: number, path: string | null) {
    super();
    this.lines = lines;
    this.at = at;
    this.path = path;
  }
  eq(other: Earlier) {
    return other.lines === this.lines && other.at === this.at && other.path === this.path;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-relay-fold";
    el.textContent = this.path
      ? `… ${this.lines} earlier lines in ${this.path} — click, or :raw`
      : `… ${this.lines} earlier lines — click, or :raw, to see them`;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ effects: expand.of(this.at) });
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const expand = StateEffect.define<number>();
const collapse = StateEffect.define<null>();

export function opened(tr: { effects: readonly StateEffect<unknown>[] }): boolean {
  return tr.effects.some((e) => e.is(expand));
}

export function refold(view: EditorView): boolean {
  const state = view.state;
  if (!state.field(expanded).length) return false;

  const head = state.selection.main.head;
  let anchor: number | null = null;
  for (const fence of openFolds(state)) {
    if (head >= fence.range.from && head <= fence.range.to) anchor = fence.node.from;
  }

  view.dispatch({
    effects: collapse.of(null),
    ...(anchor === null ? {} : { selection: { anchor } }),
  });
  return true;
}

const expanded = StateField.define<number[]>({
  create: () => [],
  update(list, tr) {
    if (tr.effects.some((e) => e.is(collapse))) return [];
    const mapped = tr.changes.empty ? list : list.map((p) => tr.changes.mapPos(p, 1));
    const added = tr.effects.filter((e) => e.is(expand)).map((e) => e.value as number);
    return added.length ? [...mapped, ...added] : mapped;
  },
});

function foldable(state: EditorState, fence: SyntaxNode) {
  const body = child(fence, "CodeText");
  if (!body) return null;

  const first = state.doc.lineAt(body.from).number;
  const last = state.doc.lineAt(body.to).number;
  if (last - first + 1 < worthFolding) return null;

  return {
    from: state.doc.line(first).from,
    to: state.doc.line(last - tailLines).to,
    lines: last - tailLines - first + 1,
  };
}

function openFolds(state: EditorState) {
  const open = state.field(expanded);
  const found: { node: SyntaxNode; range: NonNullable<ReturnType<typeof foldable>> }[] = [];
  for (const fence of outputFences(state)) {
    if (!open.some((p) => p >= fence.from && p <= fence.to)) continue;
    const range = foldable(state, fence);
    if (range) found.push({ node: fence, range });
  }
  return found;
}

function build(state: EditorState): DecorationSet {
  if (!isRendering(state)) return Decoration.none;

  const open = state.field(expanded);
  const sel = state.selection.main;
  const ranges: Range<Decoration>[] = [];

  for (const fence of outputFences(state)) {
    if (open.some((p) => p >= fence.from && p <= fence.to)) continue;

    const range = foldable(state, fence);
    if (!range) continue;
    if (sel.from <= range.to && sel.to >= range.from) continue;

    ranges.push(
      Decoration.replace({
        widget: new Earlier(
          range.lines,
          fence.from,
          spillPath(state.doc.sliceString(range.from, range.to)),
        ),
        block: true,
      }).range(range.from, range.to),
    );
  }

  return Decoration.set(ranges, true);
}

function outputFences(state: EditorState): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return undefined;
      const fence = node.node as unknown as SyntaxNode;
      const info = child(fence, "CodeInfo");
      if (info && state.doc.sliceString(info.from, info.to).trim() === outputInfo) found.push(fence);
      return false;
    },
  });
  return found;
}

function child(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) return c;
  return null;
}

export function foldOutput() {
  const field = StateField.define<DecorationSet>({
    create: build,
    update(deco, tr) {
      const stale =
        tr.docChanged ||
        tr.selection ||
        tr.effects.length > 0 ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state);
      return stale ? build(tr.state) : deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [expanded, field];
}

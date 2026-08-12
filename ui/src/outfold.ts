import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { isRendering } from "./render";
import { outputInfo } from "./runblock";

/**
 * Long output, folded to its tail.
 *
 * The agent gets the whole thing — every line is really in the document, and the
 * diff carries all of it. This only decides how much of it the human has to
 * scroll past, and it is a fold rather than a truncation for exactly that
 * reason: nothing here edits the document, so there is no version of the output
 * that only one of the two of them can see.
 *
 * The tail rather than the head, because a command's verdict is at the bottom.
 */
export const tailLines = 20;

/** Below this there is nothing to gain — the notice would replace what it hides. */
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
  constructor(lines: number, at: number) {
    super();
    this.lines = lines;
    this.at = at;
  }
  eq(other: Earlier) {
    return other.lines === this.lines && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-relay-fold";
    el.textContent = `… ${this.lines} earlier lines — click, or :raw, to see them`;
    el.addEventListener("mousedown", (e) => {
      // The caret stays where it was: this is a disclosure, not a place to type.
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

/** Which output blocks the human has opened, by a position inside each. */
const expanded = StateField.define<number[]>({
  create: () => [],
  update(list, tr) {
    const mapped = tr.changes.empty ? list : list.map((p) => tr.changes.mapPos(p, 1));
    const added = tr.effects.filter((e) => e.is(expand)).map((e) => e.value as number);
    return added.length ? [...mapped, ...added] : mapped;
  },
});

function build(state: EditorState): DecorationSet {
  if (!isRendering(state)) return Decoration.none;

  const open = state.field(expanded);
  const sel = state.selection.main;
  const ranges: Range<Decoration>[] = [];

  for (const fence of outputFences(state)) {
    const body = child(fence, "CodeText");
    if (!body) continue;
    if (open.some((p) => p >= fence.from && p <= fence.to)) continue;

    const first = state.doc.lineAt(body.from).number;
    const last = state.doc.lineAt(body.to).number;
    if (last - first + 1 < worthFolding) continue;

    const from = state.doc.line(first).from;
    const to = state.doc.line(last - tailLines).to;
    // Never fold the caret out of sight — the same rule that puts a rendered
    // block back to source while it is being worked on.
    if (sel.from <= to && sel.to >= from) continue;

    ranges.push(
      Decoration.replace({
        widget: new Earlier(last - tailLines - first + 1, fence.from),
        block: true,
      }).range(from, to),
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

/**
 * A state field, not a view plugin, for the reason renderBlocks gives: block
 * decorations have to be known before anything is drawn.
 */
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

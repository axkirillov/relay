import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { type Kind, readReview, type ReviewLine } from "../../src/diff";
import { diffPaint } from "./diffcode";

const line: Record<Kind, string | null> = {
  file: "cm-relay-diff-file",
  hunk: "cm-relay-diff-hunk",
  add: "cm-relay-diff-add",
  del: "cm-relay-diff-del",
  context: null,
  comment: "cm-relay-comment",
  nonewline: "cm-relay-diff-note",
};

const decoration: Partial<Record<Kind, Decoration>> = {};
for (const [kind, cls] of Object.entries(line)) {
  if (cls) decoration[kind as Kind] = Decoration.line({ class: cls });
}

type Review = {
  at: Map<number, ReviewLine>;
  widest: string;
};

const review = StateField.define<Review>({
  create: (state) => index(state.doc.toString()),
  update: (had, tr) => (tr.docChanged ? index(tr.state.doc.toString()) : had),
});

function index(doc: string): Review {
  const at = new Map<number, ReviewLine>();
  let widest = "";
  for (const line of readReview(doc)) {
    at.set(line.line, line);
    const shown = numbered(line);
    if (shown && shown.length > widest.length) widest = shown;
  }
  return { at, widest };
}

function numbered(line: ReviewLine): string {
  const body = line.kind === "add" || line.kind === "del" || line.kind === "context";
  return body && line.number !== null ? String(line.number) : "";
}

export function reviewNumber(state: EditorState, number: number): string | null {
  const had = state.field(review, false);
  if (!had) return null;

  if (number > state.doc.lines) {
    return had.widest.length > String(number).length ? had.widest : null;
  }

  const at = had.at.get(number);
  return at ? numbered(at) : null;
}

const marks = new Map<string, Decoration>();
function mark(cls: string): Decoration {
  let deco = marks.get(cls);
  if (!deco) marks.set(cls, (deco = Decoration.mark({ class: cls })));
  return deco;
}

function paint(view: EditorView): DecorationSet {
  const { at: map } = view.state.field(review);
  const ranges: Range<Decoration>[] = [];
  const visible = view.visibleRanges;
  if (!map.size || !visible.length) return Decoration.none;

  const first = view.state.doc.lineAt(visible[0]!.from).number;
  const last = view.state.doc.lineAt(visible[visible.length - 1]!.to).number;

  for (let n = first; n <= last; n++) {
    const at = map.get(n);
    const deco = at && decoration[at.kind];
    if (deco) ranges.push(deco.range(view.state.doc.line(n).from));
  }

  for (const { from, to, cls } of diffPaint(view.state.doc, map, first, last)) {
    ranges.push(mark(cls).range(from, to));
  }

  return Decoration.set(ranges, true);
}

const painter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = paint(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = paint(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function diffReview() {
  return [review, painter];
}

import { type EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { type Kind, readReview, type ReviewLine } from "../../src/diff";

/**
 * A ```diff block, shown as a diff and still editable in place.
 *
 * Everything else this window renders — tables, HTML, images, folded output — is
 * a replace decoration: the source is swapped for a widget, and the caret
 * landing in it puts the source back. That is exactly why none of those can be
 * edited where they stand. They are not text while they are on screen.
 *
 * A diff must not work that way, because the point of showing one is that the
 * human writes into it. And it does not need to: a diff is already one screen
 * line per diff line, already sitting in the document as the text of a fence. So
 * what is added here is paint — a line decoration per line, and the file's own
 * numbers in the gutter — and the characters underneath stay exactly what the
 * agent sent. Live-editability is not built, it is what is left by not replacing
 * anything: vim motions, the live diff, `:res` and the outer diff all keep
 * working because as far as they are concerned nothing happened.
 *
 * Which is also what makes a comment possible. The human presses `o` and types,
 * the new line starts at column 0 with no marker, and src/diff.ts calls it a
 * comment because a diff line cannot look like that. Nothing to learn, and
 * nothing to switch on.
 */
const line: Record<Kind, string | null> = {
  file: "cm-relay-diff-file",
  hunk: "cm-relay-diff-hunk",
  add: "cm-relay-diff-add",
  del: "cm-relay-diff-del",
  // Context keeps the code wash every fenced line already has. A diff reads by
  // what stands out of it, so the lines that did not change are the ones with
  // nothing said about them.
  context: null,
  comment: "cm-relay-comment",
  nonewline: "cm-relay-diff-note",
};

const decoration: Partial<Record<Kind, Decoration>> = {};
for (const [kind, cls] of Object.entries(line)) {
  if (cls) decoration[kind as Kind] = Decoration.line({ class: cls });
}

/**
 * Every reviewed line in the document, by the document line it is on.
 *
 * One reading, shared: the plugin below paints from it and the gutter numbers
 * come out of it, so a line cannot be washed as an addition while its number is
 * counted as something else. It is a state field rather than a plugin because
 * the gutter has no plugin to ask — and it depends on nothing but the text, so
 * it is up to date in the same transaction that changed the document rather
 * than a parse later, which is what a number beside a line the human is still
 * typing has to be.
 */
const review = StateField.define<Map<number, ReviewLine>>({
  create: (state) => index(state.doc.toString()),
  update: (map, tr) => (tr.docChanged ? index(tr.state.doc.toString()) : map),
});

function index(doc: string): Map<number, ReviewLine> {
  const map = new Map<number, ReviewLine>();
  for (const line of readReview(doc)) map.set(line.line, line);
  return map;
}

/**
 * What the gutter says beside a line, or null where this is none of its business
 * and the document's own line number should stand.
 *
 * Inside a diff the file's numbers replace the document's rather than sitting
 * beside them. The gutter is there so the human can point at a line when they
 * write back, and inside a patch the line they would point at is the one in the
 * file — "run.ts:88", not "the 41st line of what you sent me". Two columns of
 * numbers would say both and mean neither.
 */
export function reviewNumber(state: EditorState, number: number): string | null {
  const at = state.field(review, false)?.get(number);
  if (!at) return null;
  // A file strip, an `@@` header and a comment are not lines of the file, so
  // they get no number — which is a second, quieter way of seeing that the
  // remark you just typed is a remark.
  const body = at.kind === "add" || at.kind === "del" || at.kind === "context";
  return body && at.number !== null ? String(at.number) : "";
}

function paint(view: EditorView): DecorationSet {
  const map = view.state.field(review);
  const builder = new RangeSetBuilder<Decoration>();
  if (!map.size) return builder.finish();

  // A range set is built in order, and a block spanning two visible ranges is
  // offered its shared line twice — the guard fence.ts keeps for the same reason.
  let last = 0;

  for (const { from, to } of view.visibleRanges) {
    const first = view.state.doc.lineAt(from).number;
    const end = view.state.doc.lineAt(to).number;
    for (let n = Math.max(first, last + 1); n <= end; n++) {
      const at = map.get(n);
      const deco = at && decoration[at.kind];
      if (!deco) continue;
      builder.add(view.state.doc.line(n).from, view.state.doc.line(n).from, deco);
      last = n;
    }
  }

  return builder.finish();
}

/**
 * A view plugin, not a state field: these are line decorations, which CodeMirror
 * takes from a plugin — only the block widgets in render.ts and outfold.ts have
 * to be known over the whole document before anything is drawn. So the painting
 * is the viewport's worth and no more; the reading above is what covers the
 * document.
 */
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

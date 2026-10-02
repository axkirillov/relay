import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { type Kind, readReview, type ReviewLine } from "../../src/diff";
import { changedSpans, type ChangedSpan } from "./diffchanges";
import { diffPaint } from "./diffcode";
import { reviewFiles, type ReviewFile } from "./difffiles";

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
  changes: Map<number, ChangedSpan[]>;
  files: Map<number, ReviewFile>;
  widest: string;
};

const review = StateField.define<Review>({
  create: (state) => index(state.doc.toString()),
  update: (had, tr) => (tr.docChanged ? index(tr.state.doc.toString()) : had),
});

function index(doc: string): Review {
  const at = new Map<number, ReviewLine>();
  let widest = "";
  const lines = readReview(doc);
  for (const line of lines) {
    at.set(line.line, line);
    const shown = numbered(line);
    if (shown && shown.length > widest.length) widest = shown;
  }
  return { at, changes: changedSpans(lines), files: reviewFiles(lines), widest };
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
  const { at: map, changes } = view.state.field(review);
  const ranges: Range<Decoration>[] = [];
  const visible = view.visibleRanges;
  if (!map.size || !visible.length) return Decoration.none;

  const first = view.state.doc.lineAt(visible[0]!.from).number;
  const last = view.state.doc.lineAt(visible[visible.length - 1]!.to).number;

  for (let n = first; n <= last; n++) {
    const at = map.get(n);
    if (!at) continue;
    const start = view.state.doc.line(n).from;
    const deco = decoration[at.kind];
    if (deco) ranges.push(deco.range(start));
    for (const span of changes.get(n) ?? []) {
      ranges.push(mark(`cm-relay-diff-${at.kind}-word`).range(start + span.from, start + span.to));
    }
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

const pinnedFile = ViewPlugin.fromClass(
  class {
    dom: HTMLButtonElement;
    directory: HTMLSpanElement;
    basename: HTMLSpanElement;
    file: ReviewFile | null = null;
    destroyed = false;

    constructor(view: EditorView) {
      const doc = view.dom.ownerDocument;
      this.dom = doc.createElement("button");
      this.dom.type = "button";
      this.dom.className = "cm-relay-diff-current";
      this.dom.hidden = true;
      const path = this.dom.appendChild(doc.createElement("span"));
      path.className = "cm-relay-diff-path";
      this.directory = path.appendChild(doc.createElement("span"));
      this.directory.className = "cm-relay-diff-directory";
      this.basename = path.appendChild(doc.createElement("span"));
      this.basename.className = "cm-relay-diff-basename";
      const jump = this.dom.appendChild(doc.createElement("span"));
      jump.textContent = "↑";
      jump.setAttribute("aria-hidden", "true");
      view.dom.insertBefore(this.dom, view.scrollDOM);
      this.dom.onclick = () => {
        if (!this.file) return;
        const anchor = view.state.doc.line(this.file.header).from;
        view.dispatch({
          selection: { anchor },
          effects: EditorView.scrollIntoView(anchor, { y: "start", yMargin: 0 }),
        });
        view.focus();
      };
      this.measure(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.file = null;
      if (update.geometryChanged || update.viewportChanged) this.measure(update.view);
    }

    measure(view: EditorView) {
      view.requestMeasure({
        key: this,
        read: () => {
          if (this.destroyed) return null;
          const rect = view.scrollDOM.getBoundingClientRect();
          const top = Math.max(0, rect.top);
          const height = top - view.documentTop + 0.01;
          if (top >= rect.bottom || height < 0) return null;
          const block = view.lineBlockAtHeight(height);
          if (height >= block.bottom) return null;
          const number = view.state.doc.lineAt(block.from).number;
          return view.state.field(review).files.get(number) ?? null;
        },
        write: (file) => {
          if (this.destroyed) return;
          this.file = file;
          const hidden = !file;
          const resized = this.dom.hidden !== hidden;
          this.dom.hidden = hidden;
          const name = file?.name ?? "";
          const title = name ? `Back to file header: ${name}` : "";
          if (this.dom.title !== title) {
            const slash = name.lastIndexOf("/") + 1;
            this.directory.textContent = name.slice(0, slash);
            this.basename.textContent = name.slice(slash);
            this.dom.title = title;
            this.dom.setAttribute("aria-label", title);
          }
          if (resized) view.requestMeasure();
        },
      });
    }

    destroy() {
      this.destroyed = true;
      this.dom.remove();
    }
  },
  { eventObservers: { scroll(_event, view) { this.measure(view); } } },
);

export function diffReview() {
  return [review, painter, pinnedFile];
}

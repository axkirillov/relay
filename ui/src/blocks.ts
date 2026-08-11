import { Annotation, EditorState, RangeSetBuilder, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

export const OPEN = "<<< USER >>>";
export const CLOSE = "<<< /USER >>>";

// Marks a transaction as relay's own structural edit, so the protection filter
// lets it through. Everything else is judged on where it lands.
export const relayEdit = Annotation.define<boolean>();

export interface Block {
  openLine: number;
  closeLine: number;
  from: number; // first editable offset
  to: number; // last editable offset
}

/** Every USER block in the document, in order. */
export function scanBlocks(doc: Text): Block[] {
  const blocks: Block[] = [];
  let open = 0;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text.trim();
    if (text === OPEN) {
      open = n;
    } else if (text === CLOSE && open > 0 && n > open + 1) {
      blocks.push({
        openLine: open,
        closeLine: n,
        from: doc.line(open).to + 1,
        to: doc.line(n).from - 1,
      });
      open = 0;
    }
  }
  return blocks;
}

/** True when [from,to] lies wholly inside one block's editable interior. */
export function isEditable(doc: Text, from: number, to: number): boolean {
  return scanBlocks(doc).some((b) => from >= b.from && to <= b.to);
}

/**
 * Agent text is read-only. A change is allowed only if it falls inside a USER
 * block, or relay made it itself. Refused edits are dropped whole and reported
 * through onRefuse, so the boundary is visible instead of feeling like a dead
 * keyboard.
 */
export function protectAgentText(onRefuse: () => void) {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(relayEdit)) return tr;
    let ok = true;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (!isEditable(tr.startState.doc, fromA, toA)) ok = false;
    });
    if (ok) return tr;
    queueMicrotask(onRefuse);
    return [];
  });
}

const userLine = Decoration.line({ class: "cm-relay-user" });
const markerLine = Decoration.line({ class: "cm-relay-marker" });
const firstLine = Decoration.line({ class: "cm-relay-user cm-relay-first" });
const lastLine = Decoration.line({ class: "cm-relay-user cm-relay-last" });

function blockDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const b of scanBlocks(state.doc)) {
    for (let n = b.openLine; n <= b.closeLine; n++) {
      const line = state.doc.line(n);
      if (n === b.openLine) builder.add(line.from, line.from, firstLine);
      else if (n === b.closeLine) builder.add(line.from, line.from, lastLine);
      else builder.add(line.from, line.from, userLine);
      if (n === b.openLine || n === b.closeLine) {
        builder.add(line.from, line.from, markerLine);
      }
    }
  }
  return builder.finish();
}

export const blockHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = blockDecorations(view.state);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = blockDecorations(u.state);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Insert an empty USER block above or below the paragraph the cursor is in,
 * and return the offset to put the cursor at.
 */
export function insertBlock(view: EditorView, above: boolean): number {
  const doc = view.state.doc;
  let n = doc.lineAt(view.state.selection.main.head).number;

  // Walk to the edge of the current paragraph so the block lands between
  // paragraphs rather than splitting one.
  if (above) {
    while (n > 1 && doc.line(n - 1).text.trim() !== "") n--;
  } else {
    while (n < doc.lines && doc.line(n + 1).text.trim() !== "") n++;
  }

  const line = doc.line(n);
  const at = above ? line.from : line.to;
  const insert = above
    ? `${OPEN}\n\n${CLOSE}\n\n`
    : `\n\n${OPEN}\n\n${CLOSE}`;
  const cursor = above
    ? at + OPEN.length + 1
    : at + 2 + OPEN.length + 1;

  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: cursor },
    scrollIntoView: true,
    annotations: relayEdit.of(true),
  });
  return cursor;
}

/** Move the cursor to the next or previous USER block. */
export function jumpBlock(view: EditorView, forward: boolean): boolean {
  const blocks = scanBlocks(view.state.doc);
  if (blocks.length === 0) return false;
  const head = view.state.selection.main.head;
  const target = forward
    ? blocks.find((b) => b.from > head) ?? blocks[0]
    : [...blocks].reverse().find((b) => b.to < head) ?? blocks[blocks.length - 1];
  view.dispatch({
    selection: { anchor: target.from },
    scrollIntoView: true,
    annotations: relayEdit.of(true),
  });
  return true;
}

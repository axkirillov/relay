import type { Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { diffWordsWithSpace } from "diff";

export type Stats = { added: number; removed: number };

const addedMark = Decoration.mark({ class: "cm-relay-add" });
const touchedLine = Decoration.line({ class: "cm-relay-touched" });

const maxGhost = 240;

/**
 * Text the human deleted, kept visible where it used to be. Without this a
 * deletion leaves no trace and the document quietly stops being the agent's.
 */
class Ghost extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: Ghost) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-relay-del";
    const flat = this.text.replace(/\n/g, "⏎");
    el.textContent = flat.length > maxGhost ? `${flat.slice(0, maxGhost)}…` : flat;
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * Diffs the buffer against what the agent sent, on every keystroke, and paints
 * the difference: insertions highlighted, deletions left behind as ghosts, and
 * a bar down every line that is no longer the agent's.
 */
export function liveDiff(original: string, onStats: (s: Stats) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view, original, onStats);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = build(update.view, original, onStats);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function build(view: EditorView, original: string, onStats: (s: Stats) => void): DecorationSet {
  const doc = view.state.doc;
  const parts = diffWordsWithSpace(original, doc.toString());

  const ranges: Range<Decoration>[] = [];
  const lines = new Set<number>();
  const stats: Stats = { added: 0, removed: 0 };
  let pos = 0;

  for (const part of parts) {
    if (part.added) {
      const end = Math.min(pos + part.value.length, doc.length);
      if (end > pos) {
        ranges.push(addedMark.range(pos, end));
        touch(view, lines, pos, end);
        stats.added++;
      }
      pos = end;
    } else if (part.removed) {
      ranges.push(Decoration.widget({ widget: new Ghost(part.value), side: -1 }).range(pos));
      touch(view, lines, pos, pos);
      stats.removed++;
    } else {
      pos += part.value.length;
    }
  }

  for (const from of lines) ranges.push(touchedLine.range(from));
  onStats(stats);
  return Decoration.set(ranges, true);
}

function touch(view: EditorView, lines: Set<number>, from: number, to: number) {
  const doc = view.state.doc;
  const first = doc.lineAt(Math.min(from, doc.length)).number;
  const last = doc.lineAt(Math.min(to, doc.length)).number;
  for (let n = first; n <= last; n++) lines.add(doc.line(n).from);
}

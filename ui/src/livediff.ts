import { type Range, StateField } from "@codemirror/state";
import type { Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { diffLines, diffWordsWithSpace } from "diff";

export type Stats = { added: number; removed: number };

type Result = { deco: DecorationSet; stats: Stats };

const addedMark = Decoration.mark({ class: "cm-relay-add" });
const addedLine = Decoration.line({ class: "cm-relay-add-line" });
const touchedLine = Decoration.line({ class: "cm-relay-touched" });

/** Below this, two lines are different lines rather than one line edited. */
const refineThreshold = 0.5;
const maxGhostLines = 30;

/** Words the human took out, kept where they were, inside an edited line. */
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
    el.textContent = this.text.replace(/\n/g, "⏎");
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/** Whole lines the human deleted, standing in the gap they left behind. */
class GhostLines extends WidgetType {
  constructor(readonly lines: string[]) {
    super();
  }
  eq(other: GhostLines) {
    return other.lines.length === this.lines.length && other.lines.every((l, i) => l === this.lines[i]);
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-relay-del-block";
    for (const text of this.lines.slice(0, maxGhostLines)) {
      const el = document.createElement("div");
      el.className = "cm-relay-del-line";
      el.textContent = text || " ";
      wrap.appendChild(el);
    }
    if (this.lines.length > maxGhostLines) {
      const more = document.createElement("div");
      more.className = "cm-relay-del-more";
      more.textContent = `… ${this.lines.length - maxGhostLines} more deleted lines`;
      wrap.appendChild(more);
    }
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * Paints the buffer against what the agent sent, on every keystroke.
 *
 * Lines first, words second — the same order git works in. Diffing words across
 * the whole document reads badly: delete one line and the words either side get
 * paired up with words that happen to match, so a clean deletion comes back as
 * a scatter of additions and removals. So the shape of the change is decided at
 * line level, and words are only diffed inside a line that was edited rather
 * than replaced.
 */
export function liveDiff(original: string, onStats: (s: Stats) => void) {
  const field = StateField.define<Result>({
    create: (state) => build(state.doc, original),
    update: (value, tr) => (tr.docChanged ? build(tr.state.doc, original) : value),
    provide: (f) => EditorView.decorations.from(f, (r) => r.deco),
  });

  const report = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        onStats(view.state.field(field).stats);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) onStats(u.state.field(field).stats);
      }
    },
  );

  return [field, report];
}

function build(doc: Text, original: string): Result {
  const parts = diffLines(original, doc.toString());
  const ranges: Range<Decoration>[] = [];
  const stats: Stats = { added: 0, removed: 0 };
  let pos = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (!part.added && !part.removed) {
      pos += part.value.length;
      continue;
    }

    if (part.removed) {
      const next = parts[i + 1];
      const gone = splitLines(part.value);

      if (next?.added) {
        const arrived = splitLines(next.value);
        if (pairable(gone, arrived)) {
          pos = refine(doc, gone, arrived, pos, ranges, stats);
        } else {
          ranges.push(ghost(gone, pos, doc));
          stats.removed += gone.length;
          pos = wholeLines(doc, arrived, pos, ranges, stats);
        }
        i++;
        continue;
      }

      ranges.push(ghost(gone, pos, doc));
      stats.removed += gone.length;
      continue;
    }

    pos = wholeLines(doc, splitLines(part.value), pos, ranges, stats);
  }

  return { deco: Decoration.set(ranges, true), stats };
}

function ghost(lines: string[], pos: number, doc: Text): Range<Decoration> {
  const side = pos >= doc.length ? 1 : -1;
  return Decoration.widget({ widget: new GhostLines(lines), block: true, side }).range(pos);
}

/** Every line here is the human's; light the whole line up, not just the words. */
function wholeLines(
  doc: Text,
  lines: string[],
  pos: number,
  ranges: Range<Decoration>[],
  stats: Stats,
): number {
  for (const text of lines) {
    if (pos <= doc.length) ranges.push(addedLine.range(doc.lineAt(Math.min(pos, doc.length)).from));
    stats.added++;
    pos += text.length + 1;
  }
  return pos;
}

/** Same number of lines, and each pair recognisably the same line, edited. */
function pairable(gone: string[], arrived: string[]): boolean {
  if (gone.length !== arrived.length) return false;
  return gone.every((g, i) => similarity(g, arrived[i]!) >= refineThreshold);
}

function refine(
  doc: Text,
  gone: string[],
  arrived: string[],
  start: number,
  ranges: Range<Decoration>[],
  stats: Stats,
): number {
  let pos = start;
  for (let k = 0; k < arrived.length; k++) {
    const line = arrived[k]!;
    if (pos <= doc.length) ranges.push(touchedLine.range(doc.lineAt(Math.min(pos, doc.length)).from));

    let off = 0;
    for (const word of diffWordsWithSpace(gone[k]!, line)) {
      if (word.added) {
        ranges.push(addedMark.range(pos + off, pos + off + word.value.length));
        off += word.value.length;
      } else if (word.removed) {
        ranges.push(Decoration.widget({ widget: new Ghost(word.value), side: -1 }).range(pos + off));
      } else {
        off += word.value.length;
      }
    }

    stats.added++;
    stats.removed++;
    pos += line.length + 1;
  }
  return pos;
}

function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  let same = 0;
  for (const word of diffWordsWithSpace(a, b)) {
    if (!word.added && !word.removed) same += word.value.length;
  }
  return same / Math.max(a.length, b.length, 1);
}

/** diffLines hands back a run of lines with their newlines; take them apart. */
function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

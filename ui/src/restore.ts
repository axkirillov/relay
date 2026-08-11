import type { EditorView } from "@codemirror/view";
import { diffLines } from "diff";

/**
 * Which original lines belong to a stretch of the current document.
 *
 * Restoring is not just "look up the same line number" — every insertion or
 * deletion above shifts the correspondence, and a line the human deleted has no
 * current line to select at all. So the walk carries both cursors.
 *
 * Two rules do the work. Lines the human deleted count as inside the selection
 * when the gap they left sits within the selected lines or against either edge,
 * which is what makes putting the cursor beside the gap bring them back. And
 * lines they replaced are paired off with their replacements one for one, so
 * restoring the second line of an edited paragraph asks for the second line of
 * the original — not for the whole paragraph.
 *
 * Returns a half-open range of original line indices, or null if the selection
 * corresponds to nothing.
 */
export function originalSpan(
  original: string,
  current: string,
  curFrom: number,
  curTo: number,
): { from: number; to: number } | null {
  const parts = diffLines(original, current);
  let curIdx = 0;
  let origIdx = 0;
  let from: number | null = null;
  let to = 0;

  const take = (a: number, b: number) => {
    if (from === null) from = a;
    to = Math.max(to, b);
  };
  /** Lines origIdx… stood at current boundary `at` and are gone from the doc. */
  const gap = (at: number, lo: number, hi: number) => {
    if (at >= curFrom && at <= curTo + 1) take(lo, hi);
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const n = countLines(part.value);

    if (part.removed) {
      const next = parts[i + 1];
      if (!next?.added) {
        gap(curIdx, origIdx, origIdx + n);
        origIdx += n;
        continue;
      }

      // A replacement, not a gap: pair the lines off positionally, then treat
      // whatever is left over on either side as a gap or an insertion.
      const arrived = countLines(next.value);
      const paired = Math.min(n, arrived);
      for (let k = 0; k < paired; k++) {
        if (curIdx + k >= curFrom && curIdx + k <= curTo) take(origIdx + k, origIdx + k + 1);
      }
      if (n > arrived) gap(curIdx + arrived, origIdx + arrived, origIdx + n);
      else if (arrived > n && curIdx + paired <= curTo && curIdx + arrived - 1 >= curFrom) {
        take(origIdx + n, origIdx + n);
      }
      curIdx += arrived;
      origIdx += n;
      i++;
      continue;
    }

    if (part.added) {
      if (curIdx <= curTo && curIdx + n - 1 >= curFrom) take(origIdx, origIdx);
      curIdx += n;
      continue;
    }

    const lo = Math.max(curIdx, curFrom);
    const hi = Math.min(curIdx + n - 1, curTo);
    if (lo <= hi) take(origIdx + (lo - curIdx), origIdx + (hi - curIdx) + 1);
    curIdx += n;
    origIdx += n;
  }

  return from === null ? null : { from, to };
}

/**
 * Put the document as it was sent back over a stretch of lines. Says whether
 * anything changed; the live diff in the footer says how much.
 */
export function restore(
  view: EditorView,
  original: string,
  fromLine: number,
  toLine: number,
): boolean {
  const { state } = view;

  // CodeMirror counts a document's closing newline as one more, empty, line;
  // the diff walk counts it as a terminator. Stay off that line so the two
  // agree — and so restoring to the end of the document keeps the newline.
  let last = state.doc.lines - 1;
  if (last > 0 && state.doc.line(last + 1).length === 0) last -= 1;

  const curFrom = clamp(Math.min(fromLine, toLine), 0, last);
  const curTo = clamp(Math.max(fromLine, toLine), 0, last);

  const span = originalSpan(original, state.doc.toString(), curFrom, curTo);
  if (!span) return false;

  const text = splitLines(original).slice(span.from, span.to).join("\n");

  let from = state.doc.line(curFrom + 1).from;
  let to = state.doc.line(curTo + 1).to;
  let insert = text;

  // Nothing stood here in what was sent: take the lines out rather than leave
  // blank ones behind.
  if (span.from === span.to) {
    if (to < state.doc.length) to += 1;
    else if (from > 0) from -= 1;
    insert = "";
  }

  if (state.doc.sliceString(from, to) === insert) return false;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from },
    scrollIntoView: true,
  });
  return true;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function countLines(value: string): number {
  return splitLines(value).length;
}

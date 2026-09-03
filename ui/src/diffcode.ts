import type { Language } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";

import type { Kind, ReviewLine } from "../../src/diff.ts";
import { codeLanguage, languageForPath } from "./languages.ts";
import { highlightStyle } from "./theme.ts";

export type Paint = { from: number; to: number; cls: string };

export const markerClass = "cm-relay-diff-mark";

const body: Kind[] = ["add", "del", "context"];
const within: Kind[] = [...body, "comment", "nonewline"];
const inside = (line: ReviewLine | undefined) => !!line && within.includes(line.kind);
const after: Kind[] = ["add", "context"];
const before: Kind[] = ["del", "context"];

export function diffPaint(doc: Text, at: Map<number, ReviewLine>, first: number, last: number): Paint[] {
  const out: Paint[] = [];
  if (!at.size) return out;

  let hunk: ReviewLine[] = [];
  const flush = () => {
    if (hunk.length) paintHunk(doc, hunk, out);
    hunk = [];
  };

  for (let n = opens(at, first); n <= doc.lines; n++) {
    if (n > last && !hunk.length) break;
    const line = at.get(n);

    if (line && body.includes(line.kind)) {
      hunk.push(line);
      continue;
    }
    if (inside(line)) continue;
    flush();
  }

  flush();
  return out;
}

function opens(at: Map<number, ReviewLine>, first: number): number {
  let n = first;
  while (n > 1 && inside(at.get(n)) && inside(at.get(n - 1))) n--;
  return n;
}

function paintHunk(doc: Text, hunk: ReviewLine[], out: Paint[]) {
  for (const line of hunk) {
    if (line.kind === "context") continue;
    const at = doc.line(line.line).from;
    out.push({ from: at, to: at + 1, cls: markerClass });
  }

  const lang = language(hunk[0]!);
  if (!lang) return;

  paintSide(doc, hunk, lang, after, after, out);
  if (hunk.some((l) => l.kind === "del")) paintSide(doc, hunk, lang, before, ["del"], out);
}

function language(line: ReviewLine): Language | null {
  if (line.file) return languageForPath(line.file);
  return line.lang ? codeLanguage(line.lang) : null;
}

function paintSide(doc: Text, hunk: ReviewLine[], lang: Language, inside: Kind[], take: Kind[], out: Paint[]) {
  const starts: number[] = [];
  const lengths: number[] = [];
  const documented: number[] = [];
  const kept: boolean[] = [];
  let text = "";

  for (const line of hunk) {
    if (!inside.includes(line.kind)) continue;
    const code = line.text.slice(1);
    if (text.length) text += "\n";
    starts.push(text.length);
    lengths.push(code.length);
    documented.push(doc.line(line.line).from + 1);
    kept.push(take.includes(line.kind));
    text += code;
  }

  if (!text.trim()) return;

  let i = 0;
  highlightTree(lang.parser.parse(text), highlightStyle, (from, to, cls) => {
    while (i < starts.length && starts[i]! + lengths[i]! < from) i++;
    for (let j = i; j < starts.length && starts[j]! < to; j++) {
      if (!kept[j]) continue;
      const lo = Math.max(from, starts[j]!);
      const hi = Math.min(to, starts[j]! + lengths[j]!);
      if (lo < hi) out.push({ from: documented[j]! + lo - starts[j]!, to: documented[j]! + hi - starts[j]!, cls });
    }
  });
}

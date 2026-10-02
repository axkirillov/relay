import { diffArrays } from "diff";

import type { ReviewLine } from "../../src/diff.ts";

export type ChangedSpan = { from: number; to: number };

const maxLines = 32;
const maxLineLength = 2048;
const maxRunLength = 16384;
const maxTokenWork = 1_000_000;
const tokenPattern = /[\p{L}\p{N}\p{M}_$]+|\s+|[=<>!&|+*/%?^~:-]+|./gu;
const meaningful = /[\p{L}\p{N}_$]/u;

type TokenLine = { line: number; tokens: string[]; size: number };
type Match = { score: number; before: ChangedSpan[]; after: ChangedSpan[] };

export function changedSpans(lines: ReviewLine[]): Map<number, ChangedSpan[]> {
  const out = new Map<number, ChangedSpan[]>();
  let before: ReviewLine[] = [];
  let after: ReviewLine[] = [];
  let previous = 0;
  let budget = maxTokenWork;
  const flush = () => {
    budget = compareRun(before, after, budget, out);
    before = [];
    after = [];
  };

  for (const line of lines) {
    if (line.line !== previous + 1) flush();
    previous = line.line;
    if (line.kind === "del") {
      if (after.length) flush();
      before.push(line);
    } else if (line.kind === "add") {
      after.push(line);
    } else if (line.kind !== "nonewline") {
      flush();
    }
  }
  flush();
  return out;
}

function tokenize(line: ReviewLine): TokenLine {
  const tokens = line.text.slice(1).match(tokenPattern) ?? [];
  const size = tokens.reduce((n, token) => n + (token.trim() ? token.length : 0), 0);
  return { line: line.line, tokens, size };
}

function compareRun(before: ReviewLine[], after: ReviewLine[], budget: number, out: Map<number, ChangedSpan[]>): number {
  if (!before.length || !after.length || before.length > maxLines || after.length > maxLines) return budget;
  const lines = [...before, ...after];
  if (lines.some(line => line.text.length > maxLineLength)) return budget;
  if (lines.reduce((n, line) => n + line.text.length, 0) > maxRunLength) return budget;

  const old = before.map(tokenize);
  const next = after.map(tokenize);
  const work = old.reduce((n, line) => n + line.tokens.length, 0) * next.reduce((n, line) => n + line.tokens.length, 0);
  if (work > budget) return budget;
  budget -= work;

  const matches = old.map(a => next.map(b => compareLine(a, b)));
  const scores = Array.from({ length: old.length + 1 }, () => new Float64Array(next.length + 1));
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = next.length - 1; j >= 0; j--) {
      scores[i]![j] = Math.max(
        scores[i + 1]![j]!,
        scores[i]![j + 1]!,
        (matches[i]![j]?.score ?? 0) + scores[i + 1]![j + 1]!,
      );
    }
  }

  let i = 0;
  let j = 0;
  while (i < old.length && j < next.length) {
    const match = matches[i]![j];
    if (match && scores[i]![j] === match.score + scores[i + 1]![j + 1]!) {
      if (match.before.length) out.set(old[i]!.line, match.before);
      if (match.after.length) out.set(next[j]!.line, match.after);
      i++;
      j++;
    } else if (scores[i + 1]![j]! >= scores[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return budget;
}

function compareLine(old: TokenLine, next: TokenLine): Match | null {
  const changes = diffArrays(old.tokens, next.tokens, { maxEditLength: 128 });
  if (!changes) return null;
  const before: ChangedSpan[] = [];
  const after: ChangedSpan[] = [];
  let from = 1;
  let to = 1;
  let shared = 0;
  let hasWord = false;
  for (const change of changes) {
    const length = change.value.reduce((n, token) => n + token.length, 0);
    if (change.removed) {
      before.push({ from, to: from + length });
      from += length;
    } else if (change.added) {
      after.push({ from: to, to: to + length });
      to += length;
    } else {
      shared += change.value.reduce((n, token) => n + (token.trim() ? token.length : 0), 0);
      hasWord ||= change.value.some(token => meaningful.test(token));
      from += length;
      to += length;
    }
  }
  if (!before.length && !after.length) return { score: 1, before, after };
  const score = (2 * shared) / (old.size + next.size || 1);
  return hasWord && score >= 0.5 ? { score, before, after } : null;
}

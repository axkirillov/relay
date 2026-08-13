/**
 * What the cursor is pointing at, when it is pointing at a file.
 *
 * vim settles this with `isfname`; here it is settled by what a document written
 * for a human actually looks like. A path in prose arrives wrapped — in
 * backticks, inside a markdown link, in quotes, in a table cell, with the
 * sentence's full stop stuck to the end — and none of that wrapping is part of
 * the name. So none of it is in the class of characters a path is made of, and
 * `` `src/cli.ts` ``, `[cli](src/cli.ts)` and a bare `src/cli.ts` all come out
 * the same.
 */

export type Target = { path: string; line?: number; col?: number };

// A `|` is a table's, a backtick is markdown's, a bracket is a link's, and none
// of the three has ever been in a filename anyone wrote on purpose. `:` is in,
// because `src/cli.ts:42` is one token and splitting it is this file's other job.
const inPath = /[A-Za-z0-9_./~@+:-]/;

/**
 * The path under — or ahead of — the cursor on a line.
 *
 * Ahead of, because vim looks forward along the line when the cursor is not on a
 * name, and that is the difference between `gf` working and `gf` needing the
 * cursor placed just so. It does not look backward: the path being read is the
 * one the eye is already on or coming to.
 */
export function pathAt(line: string, at: number): Target | null {
  let start = Math.max(0, Math.min(at, line.length));
  while (start < line.length && !inPath.test(line[start]!)) start++;
  if (start === line.length) return null;

  let from = start;
  while (from > 0 && inPath.test(line[from - 1]!)) from--;
  let to = start;
  while (to < line.length && inPath.test(line[to]!)) to++;

  return target(line.slice(from, to));
}

/**
 * A token, cleaned of what the sentence left on it and split at `:42:7`.
 *
 * The line is kept rather than thrown away — vim splits that across `gf` and
 * `gF`, but `src/cli.ts:42` in a relay document is a pointer at line 42, and
 * following it to line 1 is not following it.
 */
export function target(token: string): Target | null {
  // Punctuation clings to the end of the last word in a sentence. It cannot
  // cling to the front: the character class never let the space in.
  const text = token.replace(/[.,;:!?]+$/, "");
  const cut = /^(.+?)(?::(\d+))?(?::(\d+))?$/.exec(text);
  if (!cut) return null;
  return { path: cut[1]!, line: number(cut[2]), col: number(cut[3]) };
}

function number(text: string | undefined): number | undefined {
  return text === undefined ? undefined : Number(text);
}

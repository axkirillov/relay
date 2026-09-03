
export type Target = { path: string; line?: number; col?: number };

const inPath = /[A-Za-z0-9_./~@+:-]/;

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

export function target(token: string): Target | null {
  const text = token.replace(/[.,;:!?]+$/, "");
  const cut = /^(.+?)(?::(\d+))?(?::(\d+))?$/.exec(text);
  if (!cut) return null;
  return { path: cut[1]!, line: number(cut[2]), col: number(cut[3]) };
}

function number(text: string | undefined): number | undefined {
  return text === undefined ? undefined : Number(text);
}

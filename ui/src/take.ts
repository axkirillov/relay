
export function fence(lines: string[]): string | null {
  const body = trim(lines);
  if (!body.length) return null;
  const rail = "`".repeat(Math.max(3, longestRun(body) + 1));
  return `${rail}console\n${body.join("\n")}\n${rail}`;
}

export function withoutPrompt(lines: string[], prompt: string[]): string[] {
  for (let n = Math.min(prompt.length, lines.length); n > 0; n--) {
    const tail = prompt.slice(-n);
    if (tail.some((line) => line.trim() === "")) continue;
    if (tail.every((line, i) => line === lines[lines.length - n + i])) return lines.slice(0, -n);
  }
  return lines;
}

function trim(lines: string[]): string[] {
  const out = lines.map((l) => l.replace(/\s+$/, ""));
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

function longestRun(lines: string[]): number {
  let most = 0;
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) most = Math.max(most, run.length);
  }
  return most;
}

export function insertion(doc: string, pos: number, block: string): { from: number; insert: string } {
  const from = endOfLine(doc, Math.max(0, Math.min(pos, doc.length)));
  const before = doc.slice(0, from);
  const after = doc.slice(from);
  const lead = before === "" ? 0 : 2 - trailingBlank(before);
  const trail = after.trim() === "" ? (after.startsWith("\n") ? 0 : 1) : 2 - leadingBlank(after);
  return { from, insert: `${"\n".repeat(lead)}${block}${"\n".repeat(trail)}` };
}

function endOfLine(doc: string, pos: number): number {
  const next = doc.indexOf("\n", pos);
  return next === -1 ? doc.length : next;
}

function trailingBlank(before: string): number {
  return /\n\s*?\n$/.test(before) ? 2 : before.endsWith("\n") ? 1 : 0;
}

function leadingBlank(after: string): number {
  return /^\n[^\S\n]*\n/.test(after) ? 2 : after.startsWith("\n") ? 1 : 0;
}

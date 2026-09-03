
const inLink = String.raw`[^\s<>"'\`|]*`;
const opens = String.raw`(?:https?://|file://|mailto:|www\.)`;

const shape = new RegExp(`${opens}${inLink}`, "gi");
const whole = new RegExp(`^${opens}${inLink}$`, "i");

export function urlAt(text: string, at: number): string | null {
  const from = Math.max(0, Math.min(at, text.length));
  for (const m of text.matchAll(shape)) {
    if (m.index + m[0].length <= from) continue;
    const found = url(m[0]);
    if (found) return found;
  }
  return null;
}

export function url(token: string): string | null {
  const text = trim(token.trim());
  if (!whole.test(text)) return null;
  if (/^www\./i.test(text)) return /^www\.[^\s.]+\.[^\s.]/i.test(text) ? `https://${text}` : null;
  return text;
}

const closers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function trim(token: string): string {
  let text = token.replace(/^[<"'`|([{]+/, "");
  for (let was = ""; was !== text; ) {
    was = text;
    text = text.replace(/[.,;:!?*]+$/, "");
    text = text.replace(/[>"'`|]+$/, "");
    const last = text.at(-1) ?? "";
    const open = closers[last];
    if (open && count(text, last) > count(text, open)) text = text.slice(0, -1);
  }
  return text;
}

function count(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

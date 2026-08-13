/**
 * What the cursor is pointing at, when it is pointing at a link.
 *
 * goto.ts's twin, and the same reasoning: a link in a document written for a
 * human arrives wrapped — in an autolink's angle brackets, in a markdown link's
 * parentheses, in backticks, in a table cell, with the sentence's full stop
 * stuck to the end — and none of that wrapping is part of the address. So none
 * of it is in the class of characters a link is made of, and `<https://x>`,
 * `[the ticket](https://x)` and a bare `https://x` all come out the same.
 */

// A link stops at whitespace and at the characters that are only ever the
// document's own: an autolink's `<>`, a quote, a backtick, a table's `|`.
// Brackets are not in that list — an address can contain them, and a Wikipedia
// title routinely does — so an unbalanced one at the end is dealt with below.
const inLink = String.raw`[^\s<>"'\`|]*`;
// What relay will open. An allow-list rather than "anything with a scheme",
// because `javascript:` and `data:text/html` are the two this must never hand to
// the machine, and naming what is wanted is the way to be sure of that. `www.`
// is in because a browser's address bar takes it.
const opens = String.raw`(?:https?://|file://|mailto:|www\.)`;

const shape = new RegExp(`${opens}${inLink}`, "gi");
const whole = new RegExp(`^${opens}${inLink}$`, "i");

/**
 * The link under — or ahead of — the cursor on a line.
 *
 * Ahead of, because that is what `gf` does and what makes a key out of what
 * would otherwise be an aiming exercise. It also does the work for the shape a
 * link most often arrives in: on `[the ticket](https://x)` the cursor is on the
 * words, and the address is further along the line.
 *
 * Never backward: the link being opened is the one the eye is already on or
 * coming to.
 */
export function urlAt(text: string, at: number): string | null {
  const from = Math.max(0, Math.min(at, text.length));
  for (const m of text.matchAll(shape)) {
    if (m.index + m[0].length <= from) continue;
    const found = url(m[0]);
    if (found) return found;
  }
  return null;
}

/** A token, if it is a link — the address the machine should be handed. */
export function url(token: string): string | null {
  const text = trim(token.trim());
  if (!whole.test(text)) return null;
  // `www.example.com` is what a browser would take from its address bar, and it
  // goes out the way a browser would send it. A lone `www.` at the end of a
  // sentence is not an address, so a second dot is the price of the shorthand.
  if (/^www\./i.test(text)) return /^www\.[^\s.]+\.[^\s.]/i.test(text) ? `https://${text}` : null;
  return text;
}

const closers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * The address, cleaned of what the prose and the markdown left on it.
 *
 * A full stop or a comma at the end is the sentence's. A closing bracket is
 * usually the markdown link's — but not always, because an address can open one
 * itself, which `.../Fold_(higher-order_function)` does; so the bracket goes
 * only when nothing in the address opened it. Round and round until neither has
 * anything left to take, since `(https://x).` ends in one of each.
 */
function trim(token: string): string {
  // The opening half of the wrapping, which along a line never arrives at all —
  // the class a link is made of never let it in — but a whole token, selected by
  // hand or handed over by `gf`, carries.
  let text = token.replace(/^[<"'`|([{]+/, "");
  for (let was = ""; was !== text; ) {
    was = text;
    // `*` is markdown's emphasis around a bare link, not part of it.
    text = text.replace(/[.,;:!?*]+$/, "");
    // And the closing half: an autolink's `>`, a quote, a backtick.
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

/**
 * Terminal output on its way into the document.
 *
 * A pty's scrollback is not document text, and the diff is relay's only channel
 * back — so output that stays in the terminal widget reaches the agent that
 * asked for it exactly as well as output the human never ran. These two
 * functions are that crossing: what the block looks like, and where it goes.
 */

/**
 * Lines off the terminal as a fenced block.
 *
 * `console` rather than a shell dialect, because what is captured is a command
 * and its answer together, which is what an agent asked to see. Blank rows above
 * and below are the terminal's spacing, not the human's text, so they go.
 */
export function fence(lines: string[]): string | null {
  const body = trim(lines);
  if (!body.length) return null;
  // Output can quote a fence — `bat` a markdown file, or read this very document
  // — and three backticks would then end the block early.
  const rail = "`".repeat(Math.max(3, longestRun(body) + 1));
  return `${rail}console\n${body.join("\n")}\n${rail}`;
}

/**
 * The prompt the shell has drawn since, taken back off the end.
 *
 * A prompt of more than one line — a path above a `❯`, which is most people's —
 * leaves its upper lines inside the captured rows: the cursor sits on the last
 * line of the new prompt, and only that line is obviously not part of what ran.
 * Without shell integration to ask, this recognises them: a prompt repeats
 * itself, so the lines that stood above the command when it was run are what to
 * look for at the end of its output. A prompt that changed in between — the
 * command was a `cd` — is not recognised and stays, which is the harmless way
 * round.
 */
export function withoutPrompt(lines: string[], prompt: string[]): string[] {
  for (let n = Math.min(prompt.length, lines.length); n > 0; n--) {
    const tail = prompt.slice(-n);
    // Blank lines match anything and would eat real output.
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

/**
 * Where a block lands, given the document and where the caret is.
 *
 * After the caret's line rather than at the caret: a fence has to start a line
 * of its own, and dropping one into the middle of a sentence would break the
 * sentence in half to do it. The blank line on either side is markdown's, and is
 * only added where the document has not got one already.
 */
export function insertion(doc: string, pos: number, block: string): { from: number; insert: string } {
  const from = endOfLine(doc, Math.max(0, Math.min(pos, doc.length)));
  const before = doc.slice(0, from);
  const after = doc.slice(from);
  const lead = before === "" ? 0 : 2 - trailingBlank(before);
  // Nothing but blank space below, so there is nothing to be kept apart from:
  // the block wants its own line ending and no more than that.
  const trail = after.trim() === "" ? (after.startsWith("\n") ? 0 : 1) : 2 - leadingBlank(after);
  return { from, insert: `${"\n".repeat(lead)}${block}${"\n".repeat(trail)}` };
}

function endOfLine(doc: string, pos: number): number {
  const next = doc.indexOf("\n", pos);
  return next === -1 ? doc.length : next;
}

/** How much of the blank line a block wants above it is already there. */
function trailingBlank(before: string): number {
  return /\n\s*?\n$/.test(before) ? 2 : before.endsWith("\n") ? 1 : 0;
}

function leadingBlank(after: string): number {
  return /^\n[^\S\n]*\n/.test(after) ? 2 : after.startsWith("\n") ? 1 : 0;
}

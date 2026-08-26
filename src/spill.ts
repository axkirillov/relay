/**
 * The line a run writes when its output outgrew the document, naming the file
 * that has all of it.
 *
 * Written here and read back here, by the two halves that need it: the run
 * writes the line, and the fold — which hides it, head and all, behind a notice
 * of its own — has to read the path out again to name it there. One string, used
 * forwards and backwards, so the notice cannot go looking for wording that has
 * since been reworded.
 */
const names = "… long output — all of it is in ";

export function spillNotice(path: string): string {
  return `${names}${path}`;
}

/** The file a long output went to, as the text names it. */
export function spillPath(text: string): string | null {
  // The last mention, not the first: output stops going into the document at
  // this line, so most of what could say the same words is above it.
  const at = text.lastIndexOf(names);
  if (at < 0) return null;
  const rest = text.slice(at + names.length);
  const end = rest.search(/\s/);
  return (end < 0 ? rest : rest.slice(0, end)) || null;
}

/**
 * The line a run writes into the document when the human accepted while it was
 * still going.
 *
 * The block ends here as far as the agent is concerned, and the file goes on
 * being written after this relay is gone — so the agent that asked for the
 * command has somewhere to wait for the rest of the answer.
 */
const running = "… still running when this was sent — its output is in ";

export function stillRunningNotice(path: string): string {
  return `${running}${path}`;
}

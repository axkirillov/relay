import type { Language } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";

// Spelled with their extensions, the way the tested modules in src/ are: this one
// is run directly by node as well as bundled by esbuild, and node's resolver does
// not guess at a file name.
import type { Kind, ReviewLine } from "../../src/diff.ts";
import { codeLanguage, languageForPath } from "./languages.ts";
import { highlightStyle } from "./theme.ts";

/**
 * The body of a ```diff block, read as the language of the file it patches.
 *
 * The point of showing a diff is to read code, and a diff mode does not show
 * code: it shows a diff, which is two colours and a marker column. So the marker
 * is taken off every line, what is left is parsed in the file's own language, and
 * the colours that come back are painted onto the real characters where they
 * stand. What a hunk looks like afterwards is TypeScript, or PHP — the same as
 * the same lines look anywhere else in the document — and added and removed are
 * said by the wash under the line and by nothing else. Which is the only way a
 * reviewer reads a patch the way they read a file.
 *
 * The unit is a hunk, not a file and not a block. A file's hunks are lifted from
 * different places in it, so laid end to end they are not source: a `}` from line
 * 40 followed by a `case` from line 900 is a syntax error that never existed, and
 * a grammar handed one cascades from it for the rest of the block. Inside a hunk
 * the lines really are consecutive, which is as much source as a patch contains.
 *
 * And each hunk is two texts rather than one, because the interleaving is not
 * source either — every deleted line and the added line replacing it, both at
 * once, is a program in which everything was declared twice. So the old side is
 * built from the deletions and their context, the new side from the additions and
 * theirs, and each is parsed as what it is: a fragment of the file before, and a
 * fragment of the file after.
 */

/** A stretch of one document line, and the class the highlight style gives it. */
export type Paint = { from: number; to: number; cls: string };

/**
 * The marker column, said quietly.
 *
 * The `+` and the `-` stay in the document — they are the text the agent sent,
 * they are what the human's own comment is told apart by, and they are what the
 * patch is still made of when it comes back. But they are punctuation about the
 * code rather than any of it, and a reader who has the wash does not need them
 * loud. So they are dimmed to the colour the gutter numbers are.
 */
export const markerClass = "cm-relay-diff-mark";

/** The lines that are code, as against the headers and remarks around them. */
const body: Kind[] = ["add", "del", "context"];
/**
 * Every kind a hunk runs through without ending.
 *
 * A comment, or a `\ No newline` remark: not code, and not a break in it either.
 * The human writing a note in the middle of a hunk does not make the lines above
 * and below it two hunks.
 */
const within: Kind[] = [...body, "comment", "nonewline"];
const inside = (line: ReviewLine | undefined) => !!line && within.includes(line.kind);
/** The new side: the file as the patch would leave it. */
const after: Kind[] = ["add", "context"];
/** The old side: the file as it stands. */
const before: Kind[] = ["del", "context"];

/**
 * Everything to paint inside the diff bodies that reach lines `first` to `last`.
 *
 * Bounded by the viewport, because parsing is not free and a review can be
 * thousands of lines. A hunk crossing the boundary is parsed whole even so — half
 * a hunk is a different fragment, and would come back a different colour as it
 * scrolled.
 */
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
    // Anything else ends it — an `@@`, a file strip, the fence, the document.
    flush();
  }

  flush();
  return out;
}

/**
 * Where the hunk that reaches `first` starts, so that it is parsed from its top.
 *
 * Only a viewport that opens inside a hunk has anything above it to take in — the
 * walk stops before it starts otherwise, so scrolling to the prose under a review
 * does not go back and parse the last hunk of it.
 */
function opens(at: Map<number, ReviewLine>, first: number): number {
  let n = first;
  while (n > 1 && inside(at.get(n)) && inside(at.get(n - 1))) n--;
  return n;
}

function paintHunk(doc: Text, hunk: ReviewLine[], out: Paint[]) {
  for (const line of hunk) {
    // A context line's marker is a space, and there is nothing to dim about a
    // space. Only the two that are glyphs are worth a decoration.
    if (line.kind === "context") continue;
    const at = doc.line(line.line).from;
    out.push({ from: at, to: at + 1, cls: markerClass });
  }

  const lang = language(hunk[0]!);
  if (!lang) return;

  paintSide(doc, hunk, lang, after, after, out);
  // The old side is parsed only when it says something the new one cannot.
  if (hunk.some((l) => l.kind === "del")) paintSide(doc, hunk, lang, before, ["del"], out);
}

/**
 * The language for a hunk, or null where nothing here knows what it is.
 *
 * The headers win, and they win even where the extension is one this editor has
 * no language for: a patch that says the file is a `.twig` template is better
 * read as nothing at all than as the php the fence guessed for the file above it.
 * The fence's own word answers only for a fragment that never named a file.
 */
function language(line: ReviewLine): Language | null {
  if (line.file) return languageForPath(line.file);
  return line.lang ? codeLanguage(line.lang) : null;
}

/**
 * One side of a hunk, parsed as source and painted back where it came from.
 *
 * `inside` is which lines the text is built from, `take` which of them keep the
 * colours it produces. They differ for the old side: its context lines are only
 * there so the deletions are part of something, and the new side has already
 * painted them. Painting them twice would stack two spans over one word, out of
 * two parses that need not agree, with no rule saying which of them shows.
 */
function paintSide(doc: Text, hunk: ReviewLine[], lang: Language, inside: Kind[], take: Kind[], out: Paint[]) {
  /** Where each line of `text` begins in it, how long it is, and its two answers. */
  const starts: number[] = [];
  const lengths: number[] = [];
  const documented: number[] = [];
  const kept: boolean[] = [];
  let text = "";

  for (const line of hunk) {
    if (!inside.includes(line.kind)) continue;
    // The marker is the diff's character, not the file's. The line of the file is
    // everything after it — which is also why the offsets below are one past the
    // start of the document line.
    const code = line.text.slice(1);
    if (text.length) text += "\n";
    starts.push(text.length);
    lengths.push(code.length);
    documented.push(doc.line(line.line).from + 1);
    kept.push(take.includes(line.kind));
    text += code;
  }

  if (!text.trim()) return;

  // The tree is thrown away as soon as it is walked. Keeping one per hunk would
  // be a cache to invalidate, and the whole reason this is bounded by the
  // viewport is that a fragment that size parses in well under a millisecond.
  let i = 0;
  highlightTree(lang.parser.parse(text), highlightStyle, (from, to, cls) => {
    // A token can span lines — a block comment, a heredoc — so each line it
    // touches is painted separately. They arrive in order, so the walk carries on
    // from the last one rather than starting over.
    while (i < starts.length && starts[i]! + lengths[i]! < from) i++;
    for (let j = i; j < starts.length && starts[j]! < to; j++) {
      if (!kept[j]) continue;
      const lo = Math.max(from, starts[j]!);
      const hi = Math.min(to, starts[j]! + lengths[j]!);
      if (lo < hi) out.push({ from: documented[j]! + lo - starts[j]!, to: documented[j]! + hi - starts[j]!, cls });
    }
  });
}

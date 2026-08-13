/**
 * A ```diff block, read line by line.
 *
 * This is one file rather than two because both sides of relay need the same
 * reading of it. The window paints from it — a wash per line by what the line
 * is, file numbers in the gutter — and the CLI resolves the human's comments to
 * `file:line` from it on the way back out. Two readers would be two answers to
 * "is this line a comment", and the whole feature rests on that answer being the
 * same in the window and in what the agent is told.
 *
 * The rule is the marker column, and it is the diff's own, not one invented
 * here: a unified diff line opens with `+`, `-` or a space. So a line that opens
 * with none of those is not part of the patch, and there is only one thing it
 * can be — something the human wrote. That is the whole of what a human has to
 * learn: press `o` and type, and what you typed is a comment because it starts
 * at column 0.
 *
 * The cost is a comment written as a bullet — `- why no timeout here?` — which
 * opens with a marker and so reads as a deletion. That is known and accepted:
 * the document repaints as it is typed, so the line comes out red an inch from
 * the cursor rather than reaching the agent wrong. The alternative was a sigil
 * on every comment, which costs more than it saves.
 */

export type Kind =
  /** `diff --git`, `index`, `---`, `+++` — the strip that says which file. */
  | "file"
  /** An `@@` header, and with it the numbers everything under it is counted from. */
  | "hunk"
  | "add"
  | "del"
  | "context"
  /** Anything the patch has no room for, which means the human wrote it. */
  | "comment"
  /** `\ No newline at end of file`, which is a remark about the patch, not part of it. */
  | "nonewline";

export type ReviewLine = {
  /** 1-based, in the document this was read from. */
  line: number;
  kind: Kind;
  text: string;
  /**
   * Which line of the file this is — the new side where the line is in it, the
   * old side for a deletion. Either way it is the number you would point at to
   * say where something is, which is the only reason the gutter carries it.
   *
   * An `@@` header carries the line its hunk opens at, so that a comment written
   * directly under one has somewhere to point; the gutter leaves it blank, since
   * the header is not itself a line of the file.
   *
   * Null where there is no such line at all: a file strip, a comment, or a body
   * line in a fragment that never gave an `@@` to count from.
   */
  number: number | null;
  /** The file the block is in by this point, as its headers name it. */
  file: string | null;
  /**
   * The language named after `diff` on the fence — ` ```diff php ` — or null.
   *
   * Which is the fallback for where the code is highlighted, and only that: a
   * fragment with no file headers has nothing else to say what it is written in.
   * Where there are headers the file's own extension answers, per file, which is
   * the only way a patch touching four languages can be read as four languages.
   */
  lang: string | null;
};

/** A comment, and where in the reviewed code the human left it. */
export type Comment = { file: string | null; line: number | null; text: string };

/** ` ```diff ` and ` ```patch `, the two spellings languages.ts already knows. */
const diffLangs = new Set(["diff", "patch"]);

const hunkHeader = /^@@+ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * The lines of a file strip that are not `---` or `+++`. Every one of them is a
 * whole word rather than a marker, so none can be confused with a body line, and
 * they are listed only so that a rename — which is a file strip with no `---`
 * and no `+++` at all — does not read as four comments.
 */
const fileHeader =
  /^(diff --git |diff -|index |new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|Binary files |GIT binary patch)/;

export function isDiffLang(info: string): boolean {
  return diffLangs.has(info.trim().toLowerCase().split(/[\s,{]/)[0] ?? "");
}

/**
 * Every line of every diff block in a document, in order.
 *
 * The document is scanned as text rather than through a syntax tree, because the
 * CLI has no tree and because the window wants an answer that changes only when
 * the document does — a tree arrives late, and a gutter number that appears a
 * beat after the line it belongs to is worse than one that never appears.
 */
export function readReview(doc: string): ReviewLine[] {
  const lines = doc.split("\n");
  const out: ReviewLine[] = [];
  for (const block of fenced(lines)) if (isDiffLang(block.info)) read(lines, block, out);
  return out;
}

/** Where the human's remarks are, and what they are about. */
export function comments(doc: string): Comment[] {
  const out: Comment[] = [];
  // The line a comment is about is the last line of the patch above it, which is
  // where the eye is when the human presses `o`. A comment directly under an
  // `@@` header belongs to the first line of that hunk, so the header sets this
  // too rather than clearing it.
  let at: number | null = null;

  for (const line of readReview(doc)) {
    if (line.kind === "comment") {
      out.push({ file: line.file, line: at, text: line.text.trim() });
    } else if (line.kind === "file") {
      at = null;
    } else if (line.number !== null) {
      at = line.number;
    }
  }

  return out.filter((c) => c.text !== "");
}

/**
 * The comments as the agent is handed them, under the diff.
 *
 * A diff alone cannot carry these: the human's comments and the human's edits
 * both arrive as added lines, and the point of the whole feature is that the
 * agent can tell them apart. So they come back through a second part of the
 * return value, already located — which is possible at all because a comment is
 * structurally identifiable, rather than guessed at.
 */
export function commentReport(doc: string): string {
  const list = comments(doc);
  if (!list.length) return "";
  const body = list.map((c) => `${where(c)}${c.text}`).join("\n");
  return `\n# comments left in the diff\n${body}\n`;
}

function where(c: Comment): string {
  if (!c.file) return "";
  return c.line === null ? `${c.file}  ` : `${c.file}:${c.line}  `;
}

type Block = {
  info: string;
  /** 1-based line numbers of the body, inclusive; `from > to` for an empty block. */
  from: number;
  to: number;
};

/**
 * Fenced blocks, in order and never nested.
 *
 * Every fence is walked, not only the diff ones, and the scan resumes after each
 * one's close — which is what keeps a ```diff inside a ````output block from
 * being read as a review of its own. The output of `git diff` in a run block is
 * something the human ran, not something the agent asked them to review.
 */
function fenced(lines: string[]): Block[] {
  const found: Block[] = [];

  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(lines[i]!);
    if (!open) continue;

    const mark = open[1]!;
    // An unclosed fence runs to the end of the document — which is what the
    // markdown parser does with it, and what the agent meant if it forgot.
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (closes(lines[j]!, mark)) {
        end = j;
        break;
      }
    }

    found.push({ info: open[2]!.trim(), from: i + 2, to: end });
    i = end;
  }

  return found;
}

function closes(text: string, mark: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(text);
  return !!m && m[1]![0] === mark[0] && m[1]!.length >= mark.length;
}

function read(lines: string[], block: Block, out: ReviewLine[]) {
  // The whole info string is kept by `fenced` and only its first word is what
  // made this a diff, so a second word is already here to be read.
  const lang = block.info.split(/\s+/)[1] ?? null;
  let file: string | null = null;
  let inHunk = false;
  let oldNo = 0;
  let newNo = 0;
  // Whether the line before this one was part of a file strip. `--- a/x` is a
  // header rather than a deletion because of the company it keeps, and this is
  // how the second half of the pair knows it is in that company.
  let heading = false;

  for (let n = block.from; n <= block.to; n++) {
    const text = lines[n - 1] ?? "";
    const push = (kind: Kind, number: number | null) =>
      out.push({ line: n, kind, text, number, file, lang });

    const hunk = hunkHeader.exec(text);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      heading = false;
      push("hunk", newNo);
      continue;
    }

    // Before add and del, because `---` and `+++` open with those markers. A
    // `---` is a header when a `+++` follows it — which is how a patch with no
    // `diff --git` line above it, the kind relay itself prints, still opens with
    // a file strip rather than with two deletions.
    if (fileHeader.test(text) || pair(text, lines[n]) || (heading && marks(text))) {
      file = named(text) ?? file;
      inHunk = false;
      heading = true;
      push("file", null);
      continue;
    }
    heading = false;

    if (text.startsWith("\\")) {
      push("nonewline", null);
      continue;
    }

    if (text.startsWith("+")) {
      push("add", inHunk ? newNo++ : null);
      continue;
    }

    if (text.startsWith("-")) {
      push("del", inHunk ? oldNo++ : null);
      continue;
    }

    if (text.startsWith(" ")) {
      push("context", inHunk ? newNo++ : null);
      if (inHunk) oldNo++;
      continue;
    }

    // Including an empty line, which is a comment and not a blank context line.
    // A blank line of code arrives as a single space — that is what every diff
    // writes — so an empty one is the human's, either the moment after they
    // pressed `o` or the air they left around what they wrote. Reading it as
    // context instead would count it, and every number below it in the hunk
    // would be one too many for the sake of a blank line.
    push("comment", null);
  }
}

/** A `---` whose `+++` is on the next line: a file strip, not two deletions. */
function pair(text: string, next: string | undefined): boolean {
  return text.startsWith("---") && (next ?? "").startsWith("+++");
}

function marks(text: string): boolean {
  return text.startsWith("---") || text.startsWith("+++");
}

/**
 * The file a header line names, or null where it names none.
 *
 * `a/` and `b/` are git's own labels for the two sides rather than part of any
 * path, and every diff tool takes them off. `/dev/null` is the absence of a
 * file, so it never becomes the answer — which leaves a deleted file named by
 * its `---` and a new one by its `+++`.
 */
function named(text: string): string | null {
  if (marks(text)) return path(text.slice(4));
  const git = /^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/.exec(text);
  return git ? path(git[2]!) : null;
}

function path(rest: string): string | null {
  // A timestamp on a `---` line is separated by a tab, and is not the name.
  const name = (rest.split("\t")[0] ?? "").trim();
  if (!name || name === "/dev/null") return null;
  return name.replace(/^[ab]\//, "");
}

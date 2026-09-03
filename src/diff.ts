
export type Kind =
  | "file"
  | "hunk"
  | "add"
  | "del"
  | "context"
  | "comment"
  | "nonewline";

export type ReviewLine = {
  line: number;
  kind: Kind;
  text: string;
  number: number | null;
  file: string | null;
  lang: string | null;
};

export type Comment = { file: string | null; line: number | null; text: string };

const diffLangs = new Set(["diff", "patch"]);

const hunkHeader = /^@@+ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const fileHeader =
  /^(diff --git |diff -|index |new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|Binary files |GIT binary patch)/;

export function isDiffLang(info: string): boolean {
  return diffLangs.has(info.trim().toLowerCase().split(/[\s,{]/)[0] ?? "");
}

export function readReview(doc: string): ReviewLine[] {
  const lines = doc.split("\n");
  const out: ReviewLine[] = [];
  for (const block of fenced(lines)) if (isDiffLang(block.info)) read(lines, block, out);
  return out;
}

export function comments(doc: string): Comment[] {
  const out: Comment[] = [];
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
  from: number;
  to: number;
};

function fenced(lines: string[]): Block[] {
  const found: Block[] = [];

  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(lines[i]!);
    if (!open) continue;

    const mark = open[1]!;
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
  const lang = block.info.split(/\s+/)[1] ?? null;
  let file: string | null = null;
  let inHunk = false;
  let oldNo = 0;
  let newNo = 0;
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

    push("comment", null);
  }
}

function pair(text: string, next: string | undefined): boolean {
  return text.startsWith("---") && (next ?? "").startsWith("+++");
}

function marks(text: string): boolean {
  return text.startsWith("---") || text.startsWith("+++");
}

function named(text: string): string | null {
  if (marks(text)) return path(text.slice(4));
  const git = /^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/.exec(text);
  return git ? path(git[2]!) : null;
}

function path(rest: string): string | null {
  const name = (rest.split("\t")[0] ?? "").trim();
  if (!name || name === "/dev/null") return null;
  return name.replace(/^[ab]\//, "");
}

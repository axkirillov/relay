import type { ReviewLine } from "../../src/diff";

export type ReviewFile = { name: string; header: number };
export type ReviewFileSummary = ReviewFile & { added: number; removed: number };
export type ReviewFiles = {
  at: Map<number, ReviewFile>;
  heads: Map<number, ReviewFile>;
  leading: Map<number, ReviewFile>;
  list: ReviewFileSummary[];
};

export function reviewFileIndex(lines: readonly ReviewLine[]): ReviewFiles {
  const at = new Map<number, ReviewFile>();
  const heads = new Map<number, ReviewFile>();
  const leading = new Map<number, ReviewFile>();
  const totals = new Map<string, ReviewFileSummary>();
  let file: ReviewFileSummary | null = null;
  let header = 0;
  let previous: ReviewLine | undefined;
  let headLines: number[] = [];
  let beforeFirstFile: number[] = [];

  const settleHead = () => {
    if (file) for (const line of headLines) heads.set(line, file);
    headLines = [];
  };

  const finish = () => {
    settleHead();
    if (!file) return;
    const total = totals.get(file.name);
    if (total) {
      total.added += file.added;
      total.removed += file.removed;
    } else totals.set(file.name, { ...file });
  };

  for (const line of lines) {
    const separated = !previous || line.line !== previous.line + 1;
    const startsFile = line.kind === "file" && (
      previous?.kind !== "file" || line.text.startsWith("diff ") ||
      (line.text.startsWith("---") && previous.text.startsWith("+++"))
    );
    if (separated) beforeFirstFile = [];
    if (separated || startsFile) {
      finish();
      file = null;
      header = line.line;
    }
    if (line.kind === "file") {
      headLines.push(line.line);
      if (line.file) {
        file = { name: line.file, header, added: 0, removed: 0 };
        for (const before of beforeFirstFile) leading.set(before, file);
        beforeFirstFile = [];
      }
    } else if (!file) {
      beforeFirstFile.push(line.line);
    } else {
      settleHead();
      at.set(line.line, file);
      if (line.kind === "add") file.added++;
      else if (line.kind === "del") file.removed++;
    }
    previous = line;
  }
  finish();

  return { at, heads, leading, list: [...totals.values()] };
}

export function fileAt(files: ReviewFiles, line: number): ReviewFile | null {
  return files.at.get(line) ?? files.heads.get(line) ?? null;
}

export function cursorFile(files: ReviewFiles, line: number): ReviewFile | null {
  return fileAt(files, line) ?? files.leading.get(line) ?? null;
}

export function neighbourFile(files: ReviewFiles, line: number, direction: 1 | -1): ReviewFile | null {
  const headers = new Map<number, ReviewFile>();
  for (const file of [...files.heads.values(), ...files.at.values()]) headers.set(file.header, file);
  const sorted = [...headers.keys()].sort((a, b) => direction * (a - b));
  const target = sorted.find(header => direction * (header - line) > 0);
  return target === undefined ? null : headers.get(target)!;
}

export function reviewFiles(lines: readonly ReviewLine[]): Map<number, ReviewFile> {
  return reviewFileIndex(lines).at;
}

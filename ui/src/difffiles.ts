import type { ReviewLine } from "../../src/diff";

export type ReviewFile = { name: string; header: number };
export type ReviewFileSummary = ReviewFile & { added: number; removed: number };
export type ReviewFiles = { at: Map<number, ReviewFile>; list: ReviewFileSummary[] };

export function reviewFileIndex(lines: readonly ReviewLine[]): ReviewFiles {
  const at = new Map<number, ReviewFile>();
  const totals = new Map<string, ReviewFileSummary>();
  let file: ReviewFileSummary | null = null;
  let header = 0;
  let previous: ReviewLine | undefined;

  const finish = () => {
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
    if (separated || startsFile) {
      finish();
      file = null;
      header = line.line;
    }
    if (line.kind === "file") {
      if (line.file) file = { name: line.file, header, added: 0, removed: 0 };
    } else if (file) {
      at.set(line.line, file);
      if (line.kind === "add") file.added++;
      else if (line.kind === "del") file.removed++;
    }
    previous = line;
  }
  finish();

  return { at, list: [...totals.values()] };
}

export function reviewFiles(lines: readonly ReviewLine[]): Map<number, ReviewFile> {
  return reviewFileIndex(lines).at;
}

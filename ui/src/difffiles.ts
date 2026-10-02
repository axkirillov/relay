import type { ReviewLine } from "../../src/diff";

export type ReviewFile = { name: string; header: number };

export function reviewFiles(lines: readonly ReviewLine[]): Map<number, ReviewFile> {
  const files = new Map<number, ReviewFile>();
  let file: ReviewFile | null = null;
  let header = 0;
  let previous: ReviewLine | undefined;

  for (const line of lines) {
    const separated = !previous || line.line !== previous.line + 1;
    const startsFile = line.kind === "file" && (
      previous?.kind !== "file" || line.text.startsWith("diff ") ||
      (line.text.startsWith("---") && previous.text.startsWith("+++"))
    );
    if (separated || startsFile) {
      file = null;
      header = line.line;
    }
    if (line.kind === "file") {
      if (line.file) file = { name: line.file, header };
    } else if (file) {
      files.set(line.line, file);
    }
    previous = line;
  }

  return files;
}

import { spillNotice } from "../../src/spill.ts";

export type Ended = { code: number | null; stopped: boolean; capped: boolean } | "accept";

export type Row = { text: string; wrapped: boolean };

const maxDocBytes = 64 << 10;
const tailLines = 20;
const leastWorthSpilling = tailLines + 3;

export function screenText(rows: Row[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.wrapped && lines.length) lines[lines.length - 1] += row.text;
    else lines.push(row.text);
  }
  const trimmed = lines.map((line) => line.replace(/\s+$/, ""));
  while (trimmed.length && !trimmed[0]) trimmed.shift();
  while (trimmed.length && !trimmed.at(-1)) trimmed.pop();
  return trimmed.join("\n");
}

export function overflows(text: string, screenLines: number): boolean {
  return text.split("\n").length > Math.max(screenLines, leastWorthSpilling) || text.length > maxDocBytes;
}

export function spilled(text: string, screenLines: number, path: string): string {
  const lines = text.split("\n");
  const head: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    if (head.length >= Math.max(screenLines, leastWorthSpilling) || bytes + line.length + 1 > maxDocBytes) break;
    head.push(line);
    bytes += line.length + 1;
  }
  const tail = lines.slice(Math.max(head.length, lines.length - tailLines));
  const hidden = lines.length - head.length - tail.length;
  const notice = `${head.length ? `${head.join("\n")}\n\n` : ""}${spillNotice(path)}\n`;
  if (!tail.length) return notice;
  const lead = hidden > 0 ? `\n… ${hidden.toLocaleString("en-US")} more lines there. The last ${tail.length}:\n` : "\n";
  return `${notice}${lead}${tail.map(cut).join("\n")}`;
}

export function outputBody(text: string, ended: Ended): string {
  const said = text ? `${text}\n` : "";
  const marker = ending(ended);
  if (!marker) return said || "[no output]\n";
  return said ? `${said}\n${marker}\n` : `${marker}\n`;
}

function ending(ended: Ended): string {
  if (ended === "accept") return "[stopped at accept]";
  if (ended.capped) return `… output passed 8 MB — the command was stopped here`;
  if (ended.stopped) return "[stopped]";
  if (ended.code) return `[exit ${ended.code}]`;
  return "";
}

function cut(text: string): string {
  return text.length > maxDocBytes ? `${text.slice(0, maxDocBytes)}… (line cut here — the file has it whole)` : text;
}

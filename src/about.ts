import { mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";

import { aboutDir } from "./paths.ts";
import { taskDir } from "./task.ts";

export type About = {
  text: string;
  written: Date;
};

export function file(task: string): string {
  return join(aboutDir(), `${basename(taskDir(task))}.md`);
}

export function open(task: string): string {
  try {
    mkdirSync(aboutDir(), { recursive: true });
  } catch {
  }
  return file(task);
}

export function read(task: string): About | null {
  const path = file(task);
  try {
    const text = readFileSync(path, "utf8").trim();
    if (!text) return null;
    return { text, written: statSync(path).mtime };
  } catch {
    return null;
  }
}

export function stale(about: About, past: Date[]): number {
  const at = past.findIndex((when) => when > about.written);
  return at < 0 ? 0 : at + 1;
}

export function tilde(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? "~" + path.slice(home.length) : path;
}

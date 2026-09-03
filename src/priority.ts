import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tasksDir } from "./paths.ts";
import { taskDir } from "./task.ts";

function file(task: string): string {
  return join(taskDir(task), "priority");
}

export function marked(task: string): boolean {
  try {
    statSync(file(task));
    return true;
  } catch {
    return false;
  }
}

export function mark(task: string, on: boolean): void {
  const path = file(task);
  if (!on) {
    try {
      rmSync(path);
    } catch {
    }
    return;
  }
  const dir = taskDir(task);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "task"), task + "\n");
  } catch {}
  writeFileSync(path, "");
}

export function all(): string[] {
  let names: string[];
  try {
    names = readdirSync(tasksDir());
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const name of names) {
    const dir = join(tasksDir(), name);
    try {
      statSync(join(dir, "priority"));
      out.push(readFileSync(join(dir, "task"), "utf8").trim());
    } catch {
    }
  }
  return out.filter(Boolean).sort();
}

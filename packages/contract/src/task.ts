import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

import { filledFile, relayHome, tasksDir } from "./paths.ts";

export function taskOf(cwd: string): string {
  for (let dir = cwd; ; ) {
    try {
      statSync(join(dir, ".git"));
      return dir;
    } catch {
      const up = dirname(dir);
      if (up === dir) return cwd;
      dir = up;
    }
  }
}

export function note(task: string, ...ids: string[]): void {
  const dir = taskDir(task);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "task"), task + "\n");
  } catch {
    return;
  }
  for (const id of ids) {
    try {
      symlinkSync(join(relayHome(), id), join(dir, id));
    } catch {
    }
  }
}

export function fill(home = relayHome()): void {
  const marker = filledFile();
  try {
    statSync(marker);
    return;
  } catch {
  }

  let ids: string[];
  try {
    ids = readdirSync(home).filter((id) => stamped(id));
  } catch {
    ids = [];
  }

  const tasks = new Map<string, string[]>();
  const roots = new Map<string, string>();
  for (const id of ids) {
    let cwd: string | undefined;
    try {
      cwd = (JSON.parse(readFileSync(join(home, id, "meta.json"), "utf8")) as { cwd?: string }).cwd;
    } catch {
    }
    if (!cwd) continue;
    let root = roots.get(cwd);
    if (root === undefined) roots.set(cwd, (root = taskOf(cwd)));
    const held = tasks.get(root);
    if (held) held.push(id);
    else tasks.set(root, [id]);
  }
  for (const [root, held] of tasks) note(root, ...held);

  try {
    mkdirSync(relayHome(), { recursive: true });
    writeFileSync(marker, `${ids.length}\n`);
  } catch {
  }
}

export function taskDir(task: string): string {
  const short = name(task).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "task";
  const hash = createHash("sha256").update(task).digest("hex").slice(0, 6);
  return join(tasksDir(), `${short}-${hash}`);
}

export function rounds(task: string): Date[] {
  try {
    return readdirSync(taskDir(task)).filter(stamped).sort().map(opened);
  } catch {
    return [];
  }
}

function stamped(name: string): boolean {
  return /^\d{8}-\d{6}-/.test(name);
}

function opened(id: string): Date {
  const [y, m, d, hh, mm, ss] = [
    id.slice(0, 4),
    id.slice(4, 6),
    id.slice(6, 8),
    id.slice(9, 11),
    id.slice(11, 13),
    id.slice(13, 15),
  ].map(Number) as [number, number, number, number, number, number];
  return new Date(y, m - 1, d, hh, mm, ss);
}

export function name(task: string): string {
  return task.split(sep).filter(Boolean).slice(-2).join("/") || task;
}

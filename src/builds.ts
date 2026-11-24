import { mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { running } from "./detach.ts";

const holders = "holders";

export function holdBuild(entry = process.argv[1]): void {
  if (!entry) return;
  let build: string;
  try {
    build = dirname(realpathSync(entry));
  } catch {
    return;
  }
  if (basename(dirname(build)) !== "builds") return;
  const mine = join(build, holders, String(process.pid));
  try {
    mkdirSync(dirname(mine), { recursive: true });
    writeFileSync(mine, "");
  } catch {
    return;
  }
  process.once("exit", () => rmSync(mine, { force: true }));
}

export function held(build: string): boolean {
  let pids: string[];
  try {
    pids = readdirSync(join(build, holders));
  } catch {
    return false;
  }
  return pids.some((pid) => Number(pid) > 0 && running(Number(pid)));
}

export function pruneBuilds(builds: string, keep: (string | undefined)[]): string[] {
  const removed: string[] = [];
  for (const name of readdirSync(builds)) {
    if (keep.includes(name)) continue;
    const build = join(builds, name);
    if (held(build)) continue;
    rmSync(build, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}


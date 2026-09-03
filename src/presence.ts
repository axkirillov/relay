import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { alive, heartbeat } from "./live.ts";
import { closedFile, windowFile } from "./paths.ts";

export function holdScreen(): () => void {
  const file = windowFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ pid: process.pid, since: Date.now() }) + "\n");
  const stop = heartbeat(file);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    stop();
    try {
      rmSync(file);
    } catch {}
  };
}

export function screenHeld(): boolean {
  const file = windowFile();
  let pid: unknown;
  try {
    pid = JSON.parse(readFileSync(file, "utf8")).pid;
  } catch {
    return false;
  }
  return typeof pid === "number" && alive(file, pid);
}

export type Close = {
  at: number;
  url?: string;
};

export function noteClosed(url: string | null): void {
  const file = closedFile();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ at: Date.now(), url: url ?? undefined }) + "\n");
  } catch {}
}

export function lastClose(): Close {
  try {
    const { at, url } = JSON.parse(readFileSync(closedFile(), "utf8"));
    if (typeof at !== "number") return { at: 0 };
    return typeof url === "string" ? { at, url } : { at };
  } catch {
    return { at: 0 };
  }
}

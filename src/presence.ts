import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { alive, heartbeat } from "./live.ts";
import { windowFile } from "./paths.ts";

/**
 * There is one window, and this file is how everyone else knows it. The window
 * writes it on the way up and takes it away on the way out; a relay reads it to
 * decide whether to start a window, and watches it to notice one going.
 *
 * It is not a lock. Nothing waits on it, nothing is refused because of it, and a
 * window that dies without clearing it is found out by its heartbeat stopping
 * rather than by anyone having to clean up after it.
 */
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

/** Is a window up right now? */
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

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { alive, heartbeat } from "./live.ts";
import { closedFile, windowFile } from "./paths.ts";

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

export type Close = {
  /** When the window was closed. 0 if it never has been. */
  at: number;
  /** What was on screen at that moment, if anything was. */
  url?: string;
};

/**
 * The human closed the window, and this is what it was showing.
 *
 * Left behind on purpose. Closing dismisses every relay in line, and a relay
 * still waiting its turn has no chance of witnessing a window that was up for a
 * moment — so the fact is written down once rather than left for each of them to
 * have caught. The url is written for the same reason: the window is the only
 * one who knows whose document was being read when it went.
 *
 * Call this before the presence file is taken away, so a relay reading in
 * between finds a window still up rather than starting the one just closed.
 */
export function noteClosed(url: string | null): void {
  const file = closedFile();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ at: Date.now(), url: url ?? undefined }) + "\n");
  } catch {}
}

/**
 * The last close, as the window recorded it.
 *
 * Nobody clears this. A relay is dismissed only by a close later than its own
 * arrival, so yesterday's tombstone cannot touch a relay started today.
 */
export function lastClose(): Close {
  try {
    const { at, url } = JSON.parse(readFileSync(closedFile(), "utf8"));
    if (typeof at !== "number") return { at: 0 };
    return typeof url === "string" ? { at, url } : { at };
  } catch {
    return { at: 0 };
  }
}

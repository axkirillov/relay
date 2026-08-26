import { statSync, utimesSync } from "node:fs";

/** How long a file may go untouched before its writer is presumed gone. */
export const staleMs = 10_000;
/** How often a process touches the file that says it is still here. */
export const beatMs = 2_000;

/**
 * When this process was last keeping time, and so from when its own clock says
 * anything about anybody else's.
 *
 * A file nobody has touched is only evidence if this process was awake to miss
 * the touches. This machine sleeps in fifteen-minute stretches and wakes for
 * forty seconds between them; no timer fires in between, so every relay's beat
 * stops at once and every ticket in the line is nine hundred seconds stale
 * against a ten-second rule the instant the poll comes back. That swept five
 * live relays off the screen overnight.
 *
 * A gap longer than the stale window is what a wake looks like from in here, and
 * covers sleep, a SIGSTOP and a wedged loop alike without having to tell them
 * apart. Every read moves this clock as well as the watch below, because on the
 * way back the reads are what run first: `wait` polls the line every 250ms and
 * the watch beats every two seconds, both are overdue the moment the machine
 * returns, and the one due earliest runs first. A watch that alone moved this
 * clock forward would move it after the sweep it was there to stop.
 *
 * The watch earns its place at the other end: it keeps `lastSeen` current while
 * nothing is reading, so a caller that legitimately asks once a minute is not
 * mistaken for a wake and handed a grace that would stop the rule biting at all.
 *
 * Starts at now, because a process that has only just started has not been awake
 * long enough either. That is a real cost here and it is paid on purpose: a relay
 * is short-lived, so this grace covers the first ten seconds of every one of them,
 * and in those ten seconds it will sit behind a ticket left by a recycled pid
 * rather than sweep it. The other way round is worse. A relay that starts as the
 * machine wakes — which is when relays do start — would take the whole line with
 * it, and a mistake that reaches into everyone else's state is not the same size
 * as one that only slows down the process making it.
 */
let awakeSince = Date.now();
let lastSeen = Date.now();

export function keepingTime(now = Date.now()): number {
  if (now - lastSeen >= staleMs) awakeSince = now;
  lastSeen = now;
  return awakeSince;
}

const watch = setInterval(() => keepingTime(), beatMs);
watch.unref();

/**
 * Does this file's mtime say its writer is still here?
 *
 * Split out and given its clock rather than reading one, because the case that
 * matters is a wake — and a test that had to sleep the machine could not reach
 * it.
 */
export function fresh(mtimeMs: number, now = Date.now(), awake = keepingTime(now)): boolean {
  if (now - mtimeMs < staleMs) return true;
  return now - awake < staleMs;
}

/**
 * Is the process behind this file still here?
 *
 * A PID on its own is not enough: it can be recycled onto an unrelated process,
 * which would leave the line waiting on a relay that no longer exists — or a
 * relay pointing at a window that is not there. A file nobody is touching is how
 * the two are told apart. One rule, used for both the tickets and the window.
 */
export function alive(file: string, pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
  } catch (err) {
    // EPERM means the PID is taken by someone we may not signal — alive enough.
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  try {
    return fresh(statSync(file).mtimeMs);
  } catch {
    return false;
  }
}

/** Touch `file` every beat, so the others can tell this process is still here. */
export function heartbeat(file: string): () => void {
  const beat = setInterval(() => touch(file), beatMs);
  beat.unref();
  return () => clearInterval(beat);
}

export function touch(file: string): void {
  const now = new Date();
  try {
    utimesSync(file, now, now);
  } catch {}
}

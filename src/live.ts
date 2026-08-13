import { statSync, utimesSync } from "node:fs";

/** How long a file may go untouched before its writer is presumed gone. */
export const staleMs = 10_000;
/** How often a process touches the file that says it is still here. */
export const beatMs = 2_000;

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
    return Date.now() - statSync(file).mtimeMs < staleMs;
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

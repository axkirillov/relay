import { statSync, utimesSync } from "node:fs";

export const staleMs = 10_000;
export const beatMs = 2_000;

let awakeSince = Date.now();
let lastSeen = Date.now();

export function keepingTime(now = Date.now()): number {
  if (now - lastSeen >= staleMs) awakeSince = now;
  lastSeen = now;
  return awakeSince;
}

const watch = setInterval(() => keepingTime(), beatMs);
watch.unref();

export function fresh(mtimeMs: number, now = Date.now(), awake = keepingTime(now)): boolean {
  if (now - mtimeMs < staleMs) return true;
  return now - awake < staleMs;
}

export function alive(file: string, pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  try {
    return fresh(statSync(file).mtimeMs);
  } catch {
    return false;
  }
}

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

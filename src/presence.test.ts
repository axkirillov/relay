import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "relay-window-"));
// Everything follows the queue dir, so pointing that at a temp directory puts
// this whole relay — the window included — somewhere private.
process.env.RELAY_QUEUE_DIR = join(dir, "queue");

const { holdScreen, screenHeld } = await import("./presence.ts");
const { windowFile } = await import("./paths.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

const file = windowFile();
const dead = 999_999; // no such process

/** A window that says it is here, without being here. */
function claim(pid: number, ageMs = 0) {
  writeFileSync(file, JSON.stringify({ pid, since: Date.now() }) + "\n");
  if (ageMs) {
    const then = new Date(Date.now() - ageMs);
    utimesSync(file, then, then);
  }
}

check("nothing there: no window", screenHeld(), false);
check("nothing there: beside the queue, not in it", file, join(dir, "window.json"));

// --- a window of our own -----------------------------------------------------
{
  const release = holdScreen();
  check("held: a window is up", screenHeld(), true);
  check("held: and said so on disk", existsSync(file), true);

  release();
  check("released: no window", screenHeld(), false);
  check("released: and nothing left behind", existsSync(file), false);
  release();
  check("released twice: still nothing", screenHeld(), false);
}

// --- a window that is not there ----------------------------------------------
{
  claim(dead);
  check("dead pid: no window", screenHeld(), false);
}

{
  // Alive, but nothing has touched the file: a PID recycled onto something that
  // is not the window. A relay must not wait on it, and must not take its going
  // for the human closing anything.
  claim(process.ppid, 60_000);
  check("stale: no window", screenHeld(), false);
}

{
  writeFileSync(file, "not json\n");
  check("nonsense: no window", screenHeld(), false);
  writeFileSync(file, JSON.stringify({ since: Date.now() }) + "\n");
  check("no pid: no window", screenHeld(), false);
}

rmSync(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

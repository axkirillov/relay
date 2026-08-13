import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "relay-window-"));
// Everything follows the queue dir, so pointing that at a temp directory puts
// this whole relay — the window included — somewhere private.
process.env.RELAY_QUEUE_DIR = join(dir, "queue");

const { holdScreen, screenHeld, noteClosed, lastClose } = await import("./presence.ts");
const { windowFile, closedFile } = await import("./paths.ts");

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

// --- the close the window leaves behind --------------------------------------
{
  check("never closed: nothing to be dismissed by", lastClose().at, 0);
  check("never closed: nothing was on screen", lastClose().url, undefined);

  const before = Date.now();
  noteClosed("http://127.0.0.1:5001/");
  const close = lastClose();
  // What a relay compares against its own arrival: a close later than it
  // started is a close on it, and an older one cannot touch it.
  check("closed: after a relay that started before it", close.at >= before, true);
  check("closed: and not after one starting now", close.at <= Date.now(), true);
  // What a relay compares against its own url, to know whether it was the
  // document being read or one still in line.
  check("closed: said what was on screen", close.url, "http://127.0.0.1:5001/");

  // Nothing on screen — the window went before it had anything to show.
  noteClosed(null);
  check("closed on nothing: still a close", lastClose().at > 0, true);
  check("closed on nothing: nobody was being read", lastClose().url, undefined);

  writeFileSync(closedFile(), "not json\n");
  check("nonsense: never closed", lastClose(), { at: 0 });
  writeFileSync(closedFile(), JSON.stringify({ url: "http://127.0.0.1:5001/" }) + "\n");
  check("no time: never closed", lastClose(), { at: 0 });
}

rmSync(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

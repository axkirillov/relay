import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "relay-window-"));
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
const dead = 999_999;

function claim(pid: number, ageMs = 0) {
  writeFileSync(file, JSON.stringify({ pid, since: Date.now() }) + "\n");
  if (ageMs) {
    const then = new Date(Date.now() - ageMs);
    utimesSync(file, then, then);
  }
}

check("nothing there: no window", screenHeld(), false);
check("nothing there: beside the queue, not in it", file, join(dir, "window.json"));

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

{
  claim(dead);
  check("dead pid: no window", screenHeld(), false);
}

{
  claim(process.ppid, 60_000);
  check("still waking: a stale window is believed", screenHeld(), true);
}

{
  writeFileSync(file, "not json\n");
  check("nonsense: no window", screenHeld(), false);
  writeFileSync(file, JSON.stringify({ since: Date.now() }) + "\n");
  check("no pid: no window", screenHeld(), false);
}

{
  check("never closed: nothing to be dismissed by", lastClose().at, 0);
  check("never closed: nothing was on screen", lastClose().url, undefined);

  const before = Date.now();
  noteClosed("http://127.0.0.1:5001/");
  const close = lastClose();
  check("closed: after a relay that started before it", close.at >= before, true);
  check("closed: and not after one starting now", close.at <= Date.now(), true);
  check("closed: said what was on screen", close.url, "http://127.0.0.1:5001/");

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

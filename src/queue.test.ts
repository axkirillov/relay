import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "relay-queue-"));
process.env.RELAY_QUEUE_DIR = dir;

const { enter, line } = await import("./queue.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/** A ticket for a relay that is not this process. `at` is its arrival. */
function ticket(at: number, pid: number, ageMs = 0) {
  const file = join(dir, `${at}-${pid}.json`);
  writeFileSync(file, JSON.stringify({ pid, at }) + "\n");
  if (ageMs) {
    const then = new Date(Date.now() - ageMs);
    utimesSync(file, then, then);
  }
  return file;
}

function tickets(): string[] {
  return readdirSync(dir).sort();
}

/** Waits, but gives up — so a turn that never comes fails instead of hanging. */
function turnComes(t: { wait(): Promise<void> }, ms = 2000): Promise<boolean> {
  return Promise.race([
    t.wait().then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
  ]);
}

const dead = 999_999; // no such process
const live = process.ppid; // whoever ran the test

// --- an empty queue ----------------------------------------------------------
{
  const t = enter("solo", "/tmp/a.md");
  check("alone: nobody ahead", t.ahead, 0);
  check("alone: turn is now", await turnComes(t), true);
  t.leave();
  check("alone: ticket cleaned up", tickets(), []);
}

// --- a live relay ahead ------------------------------------------------------
{
  const ahead = ticket(1, live);
  const t = enter("second", "/tmp/b.md");
  check("behind: one ahead", t.ahead, 1);
  check("behind: waits", await turnComes(t, 600), false);

  rmSync(ahead);
  check("behind: goes when the one ahead leaves", await turnComes(t), true);
  t.leave();
}

// --- tickets of relays that are gone -----------------------------------------
{
  ticket(1, dead);
  const t = enter("after-a-corpse", "/tmp/c.md");
  check("dead pid: not counted", t.ahead, 0);
  check("dead pid: turn is now", await turnComes(t), true);
  check("dead pid: ticket swept", tickets().length, 1);
  t.leave();
}

{
  // Alive PID, but nothing has touched the ticket: a recycled PID, not a relay.
  ticket(1, live, 60_000);
  const t = enter("after-a-ghost", "/tmp/d.md");
  check("stale ticket: not counted", t.ahead, 0);
  check("stale ticket: turn is now", await turnComes(t), true);
  check("stale ticket: swept", tickets().length, 1);
  t.leave();
}

// --- order ------------------------------------------------------------------
{
  ticket(3, live);
  ticket(2, live);
  const t = enter("last", "/tmp/e.md");
  check("order: both ahead counted", t.ahead, 2);
  check("order: still waiting", await turnComes(t, 600), false);

  rmSync(join(dir, `3-${live}.json`));
  check("order: not by removal, by arrival", await turnComes(t, 600), false);

  rmSync(join(dir, `2-${live}.json`));
  check("order: goes when the oldest is gone", await turnComes(t), true);
  t.leave();
}

// --- a ticket taken out from under us ----------------------------------------
{
  const t = enter("robbed", "/tmp/f.md");
  rmSync(join(dir, tickets()[0]!));
  check("stolen ticket: turn still comes", await turnComes(t), true);
  check("stolen ticket: put back", tickets().length, 1);
  t.leave();
  check("stolen ticket: leaves clean", tickets(), []);
}

// --- what the window reads off the line --------------------------------------
{
  const t = enter("serving", "/tmp/g.md");
  check("url: none until the server is up", line()[0]?.url, undefined);
  check("url: but the ticket says whose it is", [line()[0]?.id, line()[0]?.source], [
    "serving",
    "/tmp/g.md",
  ]);

  t.serving("http://127.0.0.1:1234/");
  check("url: on the ticket once it is", line()[0]?.url, "http://127.0.0.1:1234/");
  t.leave();
  check("url: and gone with the relay", line(), []);
}

{
  // The window would otherwise show a document out of turn, or lose the one on
  // screen, on nothing worse than a ticket being taken.
  const t = enter("robbed-serving", "/tmp/h.md");
  t.serving("http://127.0.0.1:5678/");
  rmSync(join(dir, tickets()[0]!));
  check("stolen ticket: turn still comes", await turnComes(t), true);
  check("stolen ticket: put back with its url", line()[0]?.url, "http://127.0.0.1:5678/");
  t.leave();
}

{
  // A relay already serving does not get the screen ahead of an older one that
  // is still coming up: the line is by arrival, url or no url.
  ticket(1, live);
  const t = enter("younger", "/tmp/i.md");
  t.serving("http://127.0.0.1:9999/");
  check("order: the one still coming up is still first", line()[0]?.url, undefined);
  check("order: and the one serving waits", await turnComes(t, 600), false);
  rmSync(join(dir, `1-${live}.json`));
  check("order: then it is shown", (await turnComes(t)) && line()[0]?.url, "http://127.0.0.1:9999/");
  t.leave();
}

// --- what is still in line behind the document on screen ---------------------
{
  // None of these tickets has a url: a relay whose server is not up yet is in
  // the line and will be shown, so it counts from the moment it arrives.
  const t = enter("head", "/tmp/j.md");
  check("waiting: nothing at first", t.behind(), 0);

  const at = Date.now() + 1000;
  ticket(at, live);
  ticket(at + 1, live);
  check("waiting: two agents in line", t.behind(), 2);

  rmSync(join(dir, `${at}-${live}.json`));
  check("waiting: one fewer as they leave", t.behind(), 1);

  t.leave();
  rmSync(join(dir, `${at + 1}-${live}.json`));
}

check("nothing left behind", tickets(), []);

rmSync(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

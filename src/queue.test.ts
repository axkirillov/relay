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
function ticket(at: number, pid: number, ageMs = 0, rank?: string) {
  const file = join(dir, `${at}-${pid}.json`);
  writeFileSync(file, JSON.stringify({ pid, at, rank }) + "\n");
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

// --- rank: a task the human wrote, and the blank they were offered ------------
{
  // They pressed the key while reading someone else's document, so what they
  // asked for just now is what they see.
  ticket(1, live);
  ticket(2, live);
  const t = enter("a-task", "new task", "top");
  check("top: nobody ahead of a task", t.ahead, 0);
  check("top: turn is now, with two agents in line", await turnComes(t), true);
  t.leave();
  check("top: and the oldest agent is next", line()[0]?.at, 1);
  rmSync(join(dir, `1-${live}.json`));
  rmSync(join(dir, `2-${live}.json`));
}

{
  // Pressing it again asks for a fresh document, not the one already half
  // written — so among tasks it is the newest that is on screen.
  ticket(10, live, 0, "top");
  const t = enter("newer-task", "new task", "top");
  check("top: the newest task is first", line()[0]?.id, "newer-task");
  check("top: and the older one waits", line()[1]?.at, 10);
  check("top: it is shown at once", await turnComes(t), true);
  t.leave();
  rmSync(join(dir, `10-${live}.json`));
}

{
  // The blank holds the screen for want of anyone else and yields the instant
  // somebody wants it — however long it has been sitting there.
  const t = enter("blank", "new task", "idle");
  check("idle: shown while the line is otherwise empty", await turnComes(t), true);
  ticket(Date.now() + 1000, live);
  check("idle: an agent arriving takes the screen", line()[0]?.id, undefined);
  check("idle: even though the blank was here first", line()[1]?.id, "blank");

  // Their words are in it now, so it is theirs and it keeps the screen.
  t.promote();
  check("promote: the typed-in blank is back in front", line()[0]?.id, "blank");
  check("promote: and the agent waits", line()[1]?.id, undefined);
  t.leave();
  rmSync(join(dir, tickets()[0]!));
}

check("nothing left behind", tickets(), []);

rmSync(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

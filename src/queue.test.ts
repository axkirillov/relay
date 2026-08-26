import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The whole layout under one temp home, not just the queue: the line reads the
// marks out of the ledger beside it, and neither belongs in the real one.
const home = mkdtempSync(join(tmpdir(), "relay-queue-"));
const dir = join(home, "queue");
process.env.RELAY_QUEUE_DIR = dir;
mkdirSync(dir, { recursive: true });

const { enter, line } = await import("./queue.ts");
const { beatMs, staleMs } = await import("./live.ts");
const { mark } = await import("./priority.ts");

/** When this process started, and so when its own ten-second grace runs out. */
const started = Date.now();

/** A worktree, which is what a session is and what a mark goes on. */
const session = (name: string) => join(home, name);
const mine = session("mine");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/** A ticket for a relay that is not this process. `at` is its arrival. */
function ticket(at: number, pid: number, ageMs = 0, task?: string) {
  const file = join(dir, `${at}-${pid}.json`);
  writeFileSync(file, JSON.stringify({ pid, at, task }) + "\n");
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

/** Long enough for the thing under test to have had its turn to happen. */
function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const dead = 999_999; // no such process
const live = process.ppid; // whoever ran the test

// --- an empty queue ----------------------------------------------------------
{
  const t = enter("solo", "/tmp/a.md", mine);
  check("alone: nobody ahead", t.ahead, 0);
  check("alone: turn is now", await turnComes(t), true);
  t.leave();
  check("alone: ticket cleaned up", tickets(), []);
}

// --- a live relay ahead ------------------------------------------------------
{
  const ahead = ticket(1, live);
  const t = enter("second", "/tmp/b.md", mine);
  check("behind: one ahead", t.ahead, 1);
  check("behind: waits", await turnComes(t, 600), false);

  rmSync(ahead);
  check("behind: goes when the one ahead leaves", await turnComes(t), true);
  t.leave();
}

// --- tickets of relays that are gone -----------------------------------------
{
  ticket(1, dead);
  const t = enter("after-a-corpse", "/tmp/c.md", mine);
  check("dead pid: not counted", t.ahead, 0);
  check("dead pid: turn is now", await turnComes(t), true);
  check("dead pid: ticket swept", tickets().length, 1);
  t.leave();
}

{
  // Alive PID, but nothing has touched the ticket: a recycled PID, not a relay.
  // This process started moments ago, though, so it has not been awake long
  // enough to hold that against anybody — the same grace that stops a relay
  // waking with the machine from sweeping a line of relays that are merely
  // asleep. It keeps its place, and this one waits behind it.
  const ghost = ticket(1, live, 60_000);
  const t = enter("after-a-ghost", "/tmp/d.md", mine);
  check("still waking: a stale ticket keeps its place", t.ahead, 1);
  check("still waking: and is waited behind", await turnComes(t, 600), false);
  check("still waking: not swept", tickets().length, 2);

  rmSync(ghost);
  check("still waking: turn comes once it is really gone", await turnComes(t), true);
  t.leave();
}

// --- order ------------------------------------------------------------------
{
  ticket(3, live);
  ticket(2, live);
  const t = enter("last", "/tmp/e.md", mine);
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
  const t = enter("robbed", "/tmp/f.md", mine);
  rmSync(join(dir, tickets()[0]!));
  check("stolen ticket: turn still comes", await turnComes(t), true);
  check("stolen ticket: put back", tickets().length, 1);
  t.leave();
  check("stolen ticket: leaves clean", tickets(), []);
}

{
  // The sweep that took this ticket ran while the machine was asleep, long after
  // `wait` had returned and the human had started reading — so there is nothing
  // left watching but the beat, and a beat that only touches notices nothing:
  // `utimesSync` on a file that is not there fails into an empty catch forever.
  const t = enter("swept-while-read", "/tmp/k.md", mine);
  t.serving("http://127.0.0.1:4321/");
  await turnComes(t);
  rmSync(join(dir, tickets()[0]!));
  check("swept while read: gone for the moment", tickets(), []);

  await pause(beatMs + 400);
  check("swept while read: the beat writes it back", tickets().length, 1);
  check("swept while read: as it was, url and all", line()[0]?.url, "http://127.0.0.1:4321/");

  t.leave();
  await pause(beatMs + 400);
  check("left: the beat does not resurrect it", tickets(), []);
}

// --- the line a relay decides its turn from ----------------------------------
{
  // `wait` used to read the line, put a stolen ticket back, and then decide from
  // the read it already had — the one the ticket was missing from. A sweep that
  // empties the directory therefore read as "nobody ahead" to every relay in
  // line at once, and they all left the only loop that would have restored them.
  const t = enter("emptied-line", "/tmp/l.md", mine);
  const name = tickets()[0]!;
  rmSync(join(dir, name));
  check("emptied line: turn comes", await turnComes(t), true);
  check("emptied line: on its own ticket, not on nothing", line()[0]?.name, name);
  t.leave();
}

{
  // And a relay ahead is still ahead: putting a stolen ticket back is not a way
  // to reach the head of the line.
  const ahead = ticket(1, live);
  const t = enter("robbed-in-line", "/tmp/m.md", mine);
  rmSync(join(dir, tickets().find((n) => n !== `1-${live}.json`)!));
  check("robbed in line: still waits", await turnComes(t, 600), false);
  check("robbed in line: ticket back, behind the one ahead", line().length, 2);

  rmSync(ahead);
  check("robbed in line: then its turn comes", await turnComes(t), true);
  t.leave();
}

// --- what the window reads off the line --------------------------------------
{
  const t = enter("serving", "/tmp/g.md", mine);
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
  const t = enter("robbed-serving", "/tmp/h.md", mine);
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
  const t = enter("younger", "/tmp/i.md", mine);
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
  const t = enter("head", "/tmp/j.md", mine);
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

// --- and once this process has been awake long enough to judge --------------
{
  // The grace is over ten seconds in, and then the rule bites as it always did.
  // Waited out rather than faked, because `line` reads its own clock — and the
  // wait is usually already over by the time the checks above have run.
  await pause(Math.max(0, staleMs - (Date.now() - started)));

  ticket(1, live, 60_000);
  const t = enter("after-a-ghost-later", "/tmp/n.md", mine);
  check("awake long enough: a stale ticket is not counted", t.ahead, 0);
  check("awake long enough: turn is now", await turnComes(t), true);
  check("awake long enough: and it is swept", tickets().length, 1);
  t.leave();
}

// --- the priority session's documents go first -------------------------------
{
  // Two agents already waiting, one of them for a while. The human marks the
  // session that a third document is about to come from, and it is shown first.
  const theirs = session("theirs");
  ticket(1, live, 0, theirs);
  ticket(2, live, 0, theirs);
  mark(mine, true);
  const t = enter("marked", "/tmp/k.md", mine);
  check("priority: nobody ahead of it", t.ahead, 0);
  check("priority: turn is now", await turnComes(t), true);
  check("priority: and the two who were waiting are behind it", t.behind(), 2);
  check("priority: at the head, marked", [line()[0]?.id, line()[0]?.rank], ["marked", "top"]);
  check("priority: the rest are normal", line()[1]?.rank, "normal");

  // The mark is read as the line is read, so letting it go puts the document
  // back where arrival had it — while it is still in line.
  mark(mine, false);
  check("priority: let go, and it is behind them again", t.behind(), 0);
  check("priority: the oldest has the head back", line()[0]?.at, 1);

  t.leave();
  rmSync(join(dir, `1-${live}.json`));
  rmSync(join(dir, `2-${live}.json`));
}

{
  // A document already waiting when the mark is made is the document the mark
  // moves — this is the whole of why the rank is not written on the ticket.
  const t = enter("waiting", "/tmp/l.md", mine);
  const at = Date.now() + 1000;
  ticket(at, live, 0, session("theirs"));
  check("priority: unmarked, and it is the older of the two", line()[0]?.id, "waiting");
  mark(session("theirs"), true);
  check("priority: marked while waiting, and it is shown now", line()[0]?.at, at);
  check("priority: without its ticket being touched", line()[1]?.id, "waiting");
  mark(session("theirs"), false);
  t.leave();
  rmSync(join(dir, `${at}-${live}.json`));
}

{
  // The mark reorders sessions against each other, not a session's own two
  // questions: the second may well be about the answer to the first.
  mark(mine, true);
  ticket(1, live, 0, mine);
  ticket(3, live, 0, mine);
  ticket(2, live, 0, session("theirs"));
  check(
    "priority: oldest first among the marked, then everyone else",
    line().map((t) => [t.at, t.rank]),
    [
      [1, "top"],
      [3, "top"],
      [2, "normal"],
    ],
  );
  mark(mine, false);
  for (const at of [1, 2, 3]) rmSync(join(dir, `${at}-${live}.json`));
}

{
  // A ticket from a relay old enough not to say which session it is, and one from
  // a session nobody has marked: both are ordinary, and neither is an error.
  ticket(1, live);
  ticket(2, live, 0, session("unmarked"));
  check("priority: a ticket with no session is normal", line().map((t) => t.rank), ["normal", "normal"]);
  for (const at of [1, 2]) rmSync(join(dir, `${at}-${live}.json`));
}

check("nothing left behind", tickets(), []);

rmSync(home, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

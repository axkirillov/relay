import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "relay-task-"));
process.env.RELAY_QUEUE_DIR = join(home, "queue");

const { clock, fill, name, note, rooted, rounds, taskDir, taskOf, tilde } = await import("./task.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/** A round as one really sits on disk, and the ledger entry filing it under a task. */
function round(task: string, id: string, doc: string) {
  const dir = join(home, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sent.md"), doc);
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ id, opened: "2026-08-18T07:00:00.000Z" }));
  note(task, id);
}

// --- which task a relay belongs to -------------------------------------------
// The worktree it was run from, found by the `.git` at its root — a file in a
// worktree, a directory in a clone, and the walk cannot tell them apart because
// it does not look.
const repo = join(home, "work", "relay", "task-timeline");
mkdirSync(join(repo, "src", "deep"), { recursive: true });
writeFileSync(join(repo, ".git"), "gitdir: /somewhere/.git/worktrees/task-timeline\n");
check("the root of a worktree is the task", taskOf(repo), repo);
check("so is anywhere under it", taskOf(join(repo, "src", "deep")), repo);
const loose = join(home, "work", "nothing");
mkdirSync(loose, { recursive: true });
check("with no checkout above it, the directory is the task", taskOf(loose), loose);
check("a directory that does not exist is still an answer", taskOf(join(loose, "gone")), join(loose, "gone"));
check("and a checkout is what tells those two apart", [rooted(repo), rooted(loose)], [true, false]);
check("the task is said the way the human says it", name("/Users/x/repos/worktrees/relay/v1"), "relay/v1");
check("and a path under home is spelled the way the human spells it", tilde(join(home, "x")).startsWith(home), true);

// --- the ledger ---------------------------------------------------------------
check("a task with no rounds behind it has none", rounds(repo), []);
check("the task's directory is named for its path", taskDir(repo).startsWith(join(home, "tasks")), true);
check("named for what the human calls it", /\/relay-v1-[0-9a-f]{6}$/.test(taskDir("/Users/x/repos/worktrees/relay/v1")), true);
check(
  "two checkouts ending the same way are still two tasks",
  taskDir("/a/relay/v1") === taskDir("/b/relay/v1"),
  false,
);

round(repo, "20260817-161234-diff", "# Which cap to raise\n\nThe refresh job.\n");
round(repo, "20260818-091708-failed", "# A run that failed\n");
round(repo, "20260818-092228-close-out", "# Close out\n");
// Another task's round, in the same ~/.relay, at the same time.
round(loose, "20260818-093100-elsewhere", "# Somebody else's question\n");

check("only this task's rounds are counted", rounds(repo).length, 3);
check("oldest first", rounds(repo)[0]!.getHours(), 16);
check("the stamp in the name is the time it went up", rounds(repo).map((r) => r.getMinutes()), [12, 17, 22]);
check("the task's directory is walkable — a round of it is the round itself", (() => {
  try {
    return readFileSync(join(taskDir(repo), "20260817-161234-diff", "sent.md"), "utf8").split("\n")[0];
  } catch (e) {
    return String(e);
  }
})(), "# Which cap to raise");
check("and it says which path it stands for", readFileSync(join(taskDir(repo), "task"), "utf8"), repo + "\n");
// The name is the whole of what is read, so a round whose directory the human has
// since deleted still happened and is still counted.
check("a round whose directory is gone is still a round", (() => {
  note(repo, "20260818-095000-deleted");
  return rounds(repo).length;
})(), 4);

// --- a time, as a document says it ---------------------------------------------
const noon = new Date(2026, 7, 18, 12, 0, 0);
check("today is a clock time", clock(new Date(2026, 7, 18, 9, 5), noon), "09:05");
check("another day brings its date", clock(new Date(2026, 7, 17, 16, 12), noon), "Aug 17 16:12");
check("another year does too", clock(new Date(2025, 11, 31, 23, 59), noon), "Dec 31 23:59");

// --- the rounds that came before the ledger did ---------------------------------
// On the day this ships the ledger is empty and every task in flight has hundreds
// of answered rounds behind it. A round says which directory it was relayed from,
// so it can be filed afterwards under the task that directory belongs to.

/** A round as it sits on disk having never been filed: no ledger entry, a `cwd`. */
function unfiled(cwd: string | null, id: string, doc: string) {
  const dir = join(home, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sent.md"), doc);
  const meta: Record<string, unknown> = { id, accepted: "2026-08-18T07:10:00.000Z" };
  if (cwd) meta.cwd = cwd;
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
}

const old = join(home, "work", "relay", "run-blocks");
mkdirSync(join(old, "src"), { recursive: true });
writeFileSync(join(old, ".git"), "gitdir: /somewhere/.git/worktrees/run-blocks\n");
check("a task nobody filed has no rounds yet", rounds(old).length, 0);

unfiled(old, "20260810-090000-first", "# The first question\n");
unfiled(join(old, "src"), "20260810-100000-from-a-subdirectory", "# Asked from deeper in\n");
unfiled(old, "20260810-110000-third", "# The third\n");
unfiled(null, "20260810-120000-nowhere", "# Relayed before relay knew where\n");
// One that was filed the ordinary way and also carries a cwd, so filing it in is
// something already done.
unfiled(old, "20260810-130000-already", "# Filed once\n");
note(old, "20260810-130000-already");

fill(home);

check("the rounds are filed under the task they were relayed from", rounds(old).length, 4);
check("one already filed is filed once", new Set(rounds(old).map((r) => r.getTime())).size, 4);
check("and they are the rounds that said where they ran", rounds(old).map((r) => r.getHours()), [9, 10, 11, 13]);

// Rounds that were noted the ordinary way, in a ledger that already existed when
// this ran: filling in is additive, and says nothing about a task it found nothing
// new for.
check("what was already in the ledger is untouched", rounds(repo).length, 4);

// Once for the ledger, not once for each task: a task with no history would
// otherwise pay for a scan that can only tell it that.
unfiled(old, "20260810-140000-after", "# After the filling in\n");
fill(home);
check("it does not run twice", rounds(old).length, 4);

process.exit(fails ? 1 : 0);

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "relay-task-"));
process.env.RELAY_QUEUE_DIR = join(home, "queue");

const { fill, name, note, rounds, taskDir, taskOf } = await import("./task.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function round(task: string, id: string, doc: string) {
  const dir = join(home, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sent.md"), doc);
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ id, opened: "2026-08-18T07:00:00.000Z" }));
  note(task, id);
}

const repo = join(home, "work", "relay", "task-timeline");
mkdirSync(join(repo, "src", "deep"), { recursive: true });
writeFileSync(join(repo, ".git"), "gitdir: /somewhere/.git/worktrees/task-timeline\n");
check("the root of a worktree is the task", taskOf(repo), repo);
check("so is anywhere under it", taskOf(join(repo, "src", "deep")), repo);
const loose = join(home, "work", "nothing");
mkdirSync(loose, { recursive: true });
check("with no checkout above it, the directory is the task", taskOf(loose), loose);
check("a directory that does not exist is still an answer", taskOf(join(loose, "gone")), join(loose, "gone"));
check("the task is said the way the human says it", name("/Users/x/repos/worktrees/relay/v1"), "relay/v1");

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
check("a round whose directory is gone is still a round", (() => {
  note(repo, "20260818-095000-deleted");
  return rounds(repo).length;
})(), 4);

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
unfiled(old, "20260810-130000-already", "# Filed once\n");
note(old, "20260810-130000-already");

fill(home);

check("the rounds are filed under the task they were relayed from", rounds(old).length, 4);
check("one already filed is filed once", new Set(rounds(old).map((r) => r.getTime())).size, 4);
check("and they are the rounds that said where they ran", rounds(old).map((r) => r.getHours()), [9, 10, 11, 13]);

check("what was already in the ledger is untouched", rounds(repo).length, 4);

unfiled(old, "20260810-140000-after", "# After the filling in\n");
fill(home);
check("it does not run twice", rounds(old).length, 4);

process.exit(fails ? 1 : 0);

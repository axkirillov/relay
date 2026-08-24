import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "relay-about-"));
process.env.RELAY_QUEUE_DIR = join(home, "queue");

const { file, open, read, stale, tilde } = await import("./about.ts");
const { aboutDir } = await import("./paths.ts");
const { taskDir } = await import("./task.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/** N rounds of a task, as the times they went up — all of them before 09:41. */
function kept(n: number): Date[] {
  return Array.from({ length: n }, (_, i) => new Date(2026, 7, 18, 8, i));
}

/** Write the task's answer, and say when it was last written. */
function wrote(task: string, text: string, when = new Date(2026, 7, 18, 9, 41, 0)) {
  const path = open(task);
  writeFileSync(path, text);
  utimesSync(path, when, when);
}

const repo = join(home, "work", "relay", "task-timeline");
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, ".git"), "gitdir: /somewhere/.git/worktrees/task-timeline\n");

// --- where the answer lives -----------------------------------------------------
// composer's directory, not relay's, and named for the same slug the round ledger
// uses — which is what keeps `relay --about` and `composer --about` on one file while
// both flags exist.
check("the answer is a file under the about directory", file(repo), join(aboutDir(), `${basename(taskDir(repo))}.md`));
check("named for the task the ledger names", basename(file(repo)), `${basename(taskDir(repo))}.md`);
check("nothing exists until it is asked for", exists(aboutDir()), false);
check("asking for the path makes somewhere to write it", open(repo), file(repo));
check("and the directory is there", exists(aboutDir()), true);

// --- reading it -----------------------------------------------------------------
check("a task with no answer has none", read(repo), null);
writeFileSync(file(repo), "   \n\n");
check("and neither has one that was opened and never written", read(repo), null);

const text = `Every relay document should say what task it belongs to.

- [x] A ledger of the rounds of each task
- [ ] **An answer above every document**`;
wrote(repo, text + "\n");
check("what the agent wrote is what is read back", read(repo)!.text, text);
check("with when they last wrote it", read(repo)!.written.getHours(), 9);

check("a path under home is spelled the way the human spells it", tilde(join(homedir(), "relay", "x")), "~/relay/x");
check("one outside it is left alone", tilde("/opt/x"), "/opt/x");

// --- whether it has kept up -----------------------------------------------------
// The one thing the stderr line is worth: a round went up and the file was not
// touched. It is what tells the agent its own list is behind the work.
const dropped = [...kept(2), new Date(2026, 7, 18, 10, 0), new Date(2026, 7, 18, 11, 0)];
check("a round that went up after the answer was written leaves it behind", stale(read(repo)!, dropped), 3);
check("an answer nothing has gone up since is not behind", stale(read(repo)!, kept(4)), 0);
check("a round in the same second as the write does not accuse", stale(read(repo)!, [new Date(2026, 7, 18, 9, 41, 0)]), 0);
check("the first round of a task cannot be behind anything", stale(read(repo)!, []), 0);

function exists(path: string): boolean {
  try {
    return !!statSync(path);
  } catch {
    return false;
  }
}

console.log(fails === 0 ? "\nall ok" : `\n${fails} failed`);
process.exit(fails === 0 ? 0 : 1);

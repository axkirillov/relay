import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "relay-plan-"));
process.env.RELAY_QUEUE_DIR = join(home, "queue");

const { append, file, open, read, render, shown, stale, strip } = await import("./plan.ts");
const { taskDir } = await import("./task.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

const noon = new Date(2026, 7, 18, 12, 0, 0);

/** N rounds of a task, as the times they went up — all of them before 09:41. */
function kept(n: number): Date[] {
  return Array.from({ length: n }, (_, i) => new Date(2026, 7, 18, 8, i));
}

/** Write the task's plan, and say when it was last written. */
function wrote(task: string, text: string, when = new Date(2026, 7, 18, 9, 41, 0)) {
  const path = open(task);
  writeFileSync(path, text);
  utimesSync(path, when, when);
}

const repo = join(home, "work", "relay", "task-timeline");
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, ".git"), "gitdir: /somewhere/.git/worktrees/task-timeline\n");

// --- where the plan lives -------------------------------------------------------
// Beside the rounds of the same task, and not in the worktree: the plan is relay's
// business and not the repository's, and an untracked file in every checkout the
// human works in would have to be committed or ignored.
check("the plan is a file in the task's own directory", file(repo), join(taskDir(repo), "plan.md"));
check("nothing exists until it is asked for", exists(taskDir(repo)), false);
check("asking for the path makes somewhere to write it", open(repo), file(repo));
check("and the directory is there", exists(taskDir(repo)), true);
check("saying which worktree it stands for", readFileSync(join(taskDir(repo), "task"), "utf8"), repo + "\n");

// --- reading it -----------------------------------------------------------------
check("a task with no plan has none", read(repo), null);
writeFileSync(file(repo), "   \n\n");
check("and neither has one that was opened and never written", read(repo), null);

const text = `Every relay document should say what task it belongs to.

- [x] A ledger of the rounds of each task
- [ ] **A plan under every document**`;
wrote(repo, text + "\n");
check("what the agent wrote is what is read back", read(repo)!.text, text);
check("with when they last wrote it", read(repo)!.written.getHours(), 9);

// --- the section ----------------------------------------------------------------
const section = render(repo, read(repo), kept(8), noon);
check("the heading names the task the way the human does", section.split("\n")[0], "## The task — relay/task-timeline");
check("the agent's own text is under it, untouched", section.includes(text), true);
check(
  "and a line saying which round this is, where the file is, and when it was written",
  section.trimEnd().split("\n").pop(),
  `9th round of this task. The agent keeps this in \`${file(repo)}\`, last written 09:41.`,
);
check("a first round says so", render(repo, read(repo), [], noon).includes("1st round of this task."), true);
check("and a third", render(repo, read(repo), kept(2), noon).includes("3rd round of this task."), true);
check("the teens are not second and third", render(repo, read(repo), kept(12), noon).includes("13th round"), true);
check("a plan written on another day carries the date", render(repo, read(repo), kept(8), new Date(2026, 7, 20, 12, 0, 0)).includes("last written Aug 18 09:41"), true);
check("no plan, no section at all", render(repo, null, kept(8), noon), "");

// --- a plan the agent stopped updating ------------------------------------------
// The agent is told to update this before every relay. Whether it did is not a
// matter of opinion — a round went up and the file was not touched — and the human
// is the one being asked to trust the list, so the document is where it is said.
const dropped = [...kept(2), new Date(2026, 7, 18, 10, 30), new Date(2026, 7, 18, 11, 15)];
check("a round that went up after the plan was written leaves it behind", stale(read(repo)!, dropped), 3);
check("a plan nothing has gone up since is not behind", stale(read(repo)!, kept(4)), 0);
check("a round in the same second as the write does not accuse", stale(read(repo)!, [new Date(2026, 7, 18, 9, 41, 0)]), 0);
check("the first round of a task cannot be behind anything", stale(read(repo)!, []), 0);
check(
  "and the document says which round it stopped short of",
  render(repo, read(repo), dropped, noon).trimEnd().split("\n").pop(),
  "**Not touched since before the 3rd round — it may be behind the work.**",
);
check("a current plan says nothing of the kind", section.includes("Not touched"), false);

// A plan that grew into a document of its own would bury the question it is pasted
// under, so what is past the cap is counted rather than shown.
const long = Array.from({ length: shown + 6 }, (_, i) => `- [ ] item ${i + 1}`).join("\n");
wrote(repo, long + "\n");
const capped = render(repo, read(repo), kept(1), noon);
check("a runaway plan is cut to the cap", capped.includes(`- [ ] item ${shown}`), true);
check("and what is past it is not shown", capped.includes(`- [ ] item ${shown + 1}`), false);
check("but is said to exist", capped.includes("… and 6 more lines of it."), true);
wrote(repo, text + "\n");

// --- a task with no name --------------------------------------------------------
// An agent relaying from its own scratchpad has no checkout above it, so what the
// heading would say is a session's UUID. Saying nothing is the truer of the two.
const loose = join(home, "b00dd24a-1f3e-4a77-9c21-8e6a2f0d5b17", "scratchpad");
mkdirSync(loose, { recursive: true });
wrote(loose, "Chasing a flaky test.\n\n- [ ] Reproduce it\n");
check("with no checkout above it the heading names nothing", render(loose, read(loose), kept(1), noon).split("\n")[0], "## The task");
check("the plan under it is unchanged", render(loose, read(loose), kept(1), noon).includes("- [ ] Reproduce it"), true);

// --- the document as it goes up -------------------------------------------------
const doc = "# Which cap to raise\n\nThe refresh job.\n";
const up = append(doc, section);
check("the agent's document keeps the top", up.startsWith(doc), true);
check("a rule between the two", up.slice(doc.length), "\n---\n\n" + section);
check("nothing is added when there is nothing to add", append(doc, ""), doc);
check("a document with no trailing newline still gets one", append("# Ask", section).startsWith("# Ask\n\n---\n"), true);

// A document relayed back out of ~/.relay arrives with a plan already under it.
// Two of them, one a round out of date, is worse than either.
const again = append(up, section);
check("an earlier plan is replaced, not joined", again, up);
check("and the rule above it is not left behind", (again.match(/\n---\n/g) ?? []).length, 1);
check("a plan is dropped even when there is none to put back", append(up, ""), doc);

// The human strikes an item out in the window and the agent sends the accepted
// document again. Their edit is in the diff and belongs in the file; what goes up
// is the file as it stands now.
const struck = up.replace("- [x] A ledger of the rounds of each task", "- [x] ~~A ledger~~ done");
check("what they wrote in it does not survive into the next document", append(struck, section), up);

// A document that talks about this feature quotes the heading, in a fence, the way
// SPEC.md and README.md do. Cutting the rest of the file off after it would be
// relay eating a document it was asked to show.
const about = `# What relay writes\n\n\`\`\`\n${section}\`\`\`\n\nEvery part of that it already knew.\n`;
check("a document quoting the heading in a fence keeps everything under it", append(about, ""), about);
check("and still gets its own plan", append(about, section), about.replace(/\n$/, "") + "\n\n---\n\n" + section);

// relay listed the rounds of the task under the plan for a day, and documents
// with both sections in them are still in `~/.relay`. The plan's heading is above
// the older one, so a document sent again loses the list with it.
const both = up + "\n---\n\n## The task so far — relay/task-timeline\n\n- **09:17** Something — answered\n";
check("a document from before the list was dropped loses the list too", strip(both), doc);

// A nameless heading — the scratchpad case — is still relay's own.
const nameless = append("# Which index\n", render(loose, read(loose), kept(1), noon));
check("a nameless heading is still recognised as one", append(nameless, ""), "# Which index\n");

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

process.exit(fails ? 1 : 0);

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "relay-timeline-"));
process.env.RELAY_QUEUE_DIR = join(home, "queue");

const { append, before, clock, label, name, note, opened, render, taskDir, taskOf } = await import("./timeline.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/**
 * A round as one really sits on disk, and the ledger entry that says which task
 * it was part of. `patch` decides whether the human touched it: what relay stores
 * is the whole two-file patch, and a hunk in it is the whole of "they changed
 * something".
 */
function round(
  task: string,
  id: string,
  doc: string,
  end: { accepted?: boolean; abandoned?: boolean; hunk?: boolean; shown?: boolean } = {},
) {
  const dir = join(home, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sent.md"), doc);
  const meta: Record<string, unknown> = { id, opened: "2026-08-18T07:00:00.000Z" };
  if (end.accepted) meta.accepted = "2026-08-18T07:10:00.000Z";
  if (end.abandoned) meta.abandoned = "2026-08-18T07:10:00.000Z";
  if (end.shown === false) meta.shown = false;
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
  if (end.accepted) {
    writeFileSync(join(dir, "accepted.md"), doc);
    writeFileSync(join(dir, "diff.patch"), end.hunk ? "--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n" : "--- a\n+++ b\n");
  }
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

// --- the ledger ---------------------------------------------------------------
check("a task with no rounds behind it has no timeline", before(repo, 12, home), { rounds: [], total: 0 });
check("the task's directory is named for its path", taskDir(repo).startsWith(join(home, "tasks")), true);
check("named for what the human calls it", /\/relay-v1-[0-9a-f]{6}$/.test(taskDir("/Users/x/repos/worktrees/relay/v1")), true);
check(
  "two checkouts ending the same way are still two tasks",
  taskDir("/a/relay/v1") === taskDir("/b/relay/v1"),
  false,
);

round(repo, "20260817-161234-diff", "# Which cap to raise\n\nThe refresh job.\n", { accepted: true, hunk: true });
round(repo, "20260818-091708-failed", "# A run that failed\n", { abandoned: true });
round(repo, "20260818-092228-close-out", "# Close out\n", { accepted: true });
round(repo, "20260818-093042-open", "# Still up\n");
round(repo, "20260818-093100-queued", "# Never seen\n", { abandoned: true, shown: false });
// Another task's round, in the same ~/.relay, at the same time.
round(loose, "20260818-093100-elsewhere", "# Somebody else's question\n", { accepted: true, hunk: true });

const past = before(repo, 12, home);
check("only this task's rounds", past.rounds.map((r) => r.id), [
  "20260817-161234-diff",
  "20260818-091708-failed",
  "20260818-092228-close-out",
  "20260818-093042-open",
  "20260818-093100-queued",
]);
check("and how many there are in all", past.total, 5);
check("what each round was about, off the top of its document", past.rounds[0]!.label, "Which cap to raise");
check("edits mean they answered", past.rounds[0]!.outcome, "answered");
check("a patch with no hunk means they did not", past.rounds[2]!.outcome, "accepted as written");
check("a closed window says so", past.rounds[1]!.outcome, "closed without a reply");
check("and one still up claims nothing", past.rounds[3]!.outcome, "no answer");
check(
  "a document dismissed in the line was never declined",
  past.rounds[4]!.outcome,
  "never reached the screen",
);
check("the task's directory is walkable — a round of it is the round itself", (() => {
  try {
    return readFileSync(join(taskDir(repo), "20260817-161234-diff", "sent.md"), "utf8").split("\n")[0];
  } catch (e) {
    return String(e);
  }
})(), "# Which cap to raise");
check("and it says which path it stands for", readFileSync(join(taskDir(repo), "task"), "utf8"), repo + "\n");
check("a round whose directory is gone is left out, not fatal", (() => {
  note(repo, "20260818-095000-deleted");
  return before(repo, 12, home).rounds.length;
})(), 5);
check("but it is still counted", before(repo, 12, home).total, 6);
check("a limit keeps the recent end of the task", before(repo, 2, home).rounds.map((r) => r.id), [
  "20260818-093042-open",
  "20260818-093100-queued",
]);

// --- the time on an entry -----------------------------------------------------
check("the stamp in the name is the time it went up", opened("20260817-161234-diff").getHours(), 16);
const noon = new Date(2026, 7, 18, 12, 0, 0);
check("today is a clock time", clock(new Date(2026, 7, 18, 9, 5), noon), "09:05");
check("another day brings its date", clock(new Date(2026, 7, 17, 16, 12), noon), "Aug 17 16:12");
check("another year does too", clock(new Date(2025, 11, 31, 23, 59), noon), "Dec 31 23:59");

// --- what a document is called ------------------------------------------------
check("a heading", label("# Which cap to raise\n\nbody\n"), "Which cap to raise");
check("prose, when there is no heading", label("The refresh job hits the cap.\n"), "The refresh job hits the cap.");
check("past a frontmatter fence", label("---\ntitle: x\n---\n\n# Real\n"), "title: x");
check("emphasis is not part of what it says", label("## **The** `cap`\n"), "The cap");
check("a bullet is not either", label("- raise the cap\n"), "raise the cap");
check("a long one is cut", label("#" + " " + "x".repeat(80)).length, 60);
check("an empty document has nothing to call it", label("\n\n"), "");

// --- the section ---------------------------------------------------------------
// Read again, so the deleted round above is in the count and out of the list.
const now = before(repo, 12, home);
const section = render(repo, now.rounds, now.total, noon);
check("the heading names the task", section.split("\n")[0], "## The task so far — relay/task-timeline");
check("the task is said the way the human says it", name("/Users/x/repos/worktrees/relay/v1"), "relay/v1");
check("one line per round", section.split("\n").filter((l) => l.startsWith("- ")).length, 5);
check(
  "a line is a time, what it was about, and what became of it — and fits on one",
  section.split("\n")[3],
  "- **09:17** A run that failed — closed without a reply",
);
check("where the rounds are is said once, at the end", section.trimEnd().endsWith(`Each round is a directory in \`${taskDir(repo)}/\`.`), true);
check("and says so when it is not showing all of them", render(repo, now.rounds.slice(-2), now.total, noon).includes("The last 2 of 6."), true);
check("the first round of a task gets no section at all", render(repo, [], 0, noon), "");

// --- the document as it goes up -------------------------------------------------
const doc = "# Which cap to raise\n\nThe refresh job.\n";
const up = append(doc, section);
check("the agent's document keeps the top", up.startsWith(doc), true);
check("a rule between the two", up.slice(doc.length), "\n---\n\n" + section);
check("nothing is added when there is nothing to add", append(doc, ""), doc);
check("a document with no trailing newline still gets one", append("# Ask", section).startsWith("# Ask\n\n---\n"), true);

// A document relayed back out of ~/.relay arrives with a timeline already under
// it. Two of them, one a round out of date, is worse than either.
const again = append(up, section);
check("an earlier timeline is replaced, not joined", again, up);
check("and the rule above it is not left behind", (again.match(/\n---\n/g) ?? []).length, 1);
check("a timeline is dropped even when there is none to put back", append(up, ""), doc);

// A document that talks about this feature quotes the heading. Cutting the rest of
// SPEC.md off because it shows what a timeline looks like would be relay eating a
// document it was asked to show.
const about = `# What relay writes\n\n\`\`\`\n${section}\`\`\`\n\nEvery part of that it already knew.\n`;
check("a document quoting the heading keeps everything under it", append(about, ""), about);
check("and still gets its own timeline", append(about, section).startsWith(about.replace(/\n$/, "")), true);

process.exit(fails ? 1 : 0);

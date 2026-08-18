import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { clock, name, note, rooted, taskDir, tilde } from "./timeline.ts";

/**
 * What the task is, and where it has got to, under every document.
 *
 * The spec's first rule is that the human knows *nothing* about the task except
 * what relay has shown them, and the hardest part of that is not the question —
 * it is the ground the question stands on. They answered something about this
 * work at nine and are being asked about it at two, in a window that closed in
 * between, and the thing they have lost is not the last document: it is what the
 * whole task was for and how far along it is.
 *
 * Neither of those can be worked out from the rounds. A list of what was asked is
 * a record of the conversation, not of the work — it says nothing about what is
 * still to do, and a document's own first line is a poor summary of why it exists.
 * So this half is written rather than derived: the agent puts a short overview and
 * a to-do list in the task's `plan.md` at the start, keeps the list ticked as it
 * goes, and relay carries whatever is in that file under every document of the
 * task.
 *
 * relay owns the path and the agent owns the file. There is one copy, in a
 * directory the task already has, so a plan cannot fall out of step with itself
 * and a new session — a handoff, a restart, a second agent — finds the same file
 * from the same worktree without being told where it is.
 *
 * It is plain text in the document like everything else, so the human can strike
 * an item out or write a new one beside it, and what they write comes back in the
 * diff for the agent to fold into the file.
 */

/** relay's own heading over the plan, and what finds an earlier copy of it. */
const heading = "## The task";

/**
 * How many lines of a plan a document carries. A plan is meant to be a paragraph
 * and a list; this is the backstop against one that grew into a document of its
 * own and buried the question it was pasted under.
 */
export const shown = 40;

/** What the agent writes, and when it last wrote it. */
export type Plan = {
  /** The file's own text: the overview, then the list. relay does not touch it. */
  text: string;
  /** Its mtime — the one honest answer to "is this still true?". */
  written: Date;
};

/**
 * Where the task's plan lives: beside the rounds it is the plan for.
 *
 * The task's directory rather than the worktree, because the plan is relay's
 * business and not the repository's — it would otherwise be an untracked file in
 * every checkout the human works in, showing up in `git status` and asking to be
 * committed or ignored.
 */
export function file(task: string): string {
  return join(taskDir(task), "plan.md");
}

/**
 * The path, ready to be written to — the answer to `relay --plan`.
 *
 * The directory comes into being here rather than on first write, so that the
 * agent's next step is to write the file and not to work out that it has to make
 * a directory first. `note` with no rounds is exactly that: the directory, and the
 * `task` file saying which worktree it stands for.
 */
export function open(task: string): string {
  note(task);
  try {
    mkdirSync(taskDir(task), { recursive: true });
  } catch {
    // Unwritable — `--plan` still says where it would go, and the agent's own
    // write will fail with a better message than anything invented here.
  }
  return file(task);
}

/** The plan as it stands, or nothing when the task has none. */
export function read(task: string): Plan | null {
  const path = file(task);
  try {
    const text = readFileSync(path, "utf8").trim();
    // An empty file is a plan that was opened and never written. It should read
    // as absent rather than as a heading over nothing.
    if (!text) return null;
    return { text, written: statSync(path).mtime };
  } catch {
    return null;
  }
}

/**
 * The section as markdown, or nothing at all when there is no plan. No heading
 * over an absence: a document from a tool that does not keep plans should look
 * exactly as it did before this existed.
 *
 * `round` is which round of the task this document is — this one included, since
 * the human is reading it.
 */
export function render(task: string, plan: Plan | null, round: number, now: Date): string {
  if (!plan) return "";

  // The name only when there is a task to name. A relay from a directory with no
  // checkout above it — an agent in its own scratchpad — would be headed with a
  // session's UUID, which tells the human nothing; saying nothing is truer.
  const lines = [`${heading}${rooted(task) ? ` — ${name(task)}` : ""}`, ""];

  const body = plan.text.split("\n");
  const kept = body.slice(0, shown);
  lines.push(...kept);
  if (body.length > kept.length) lines.push("", `… and ${body.length - kept.length} more lines of it.`);

  // Who wrote this, where it is, and when — the three things the human needs to
  // judge it by. When above all: a to-do list that stopped being updated an hour
  // into a day's work is worse than none, and the only way to see that from the
  // document is to be told when it was last touched.
  const where = `The agent keeps this in \`${tilde(file(task))}\`, last written ${clock(plan.written, now)}.`;
  lines.push("", round > 0 ? `${nth(round)} round of this task. ${where}` : where);
  return lines.join("\n") + "\n";
}

/**
 * The document as it goes on screen: what the agent wrote, then a rule, then the
 * plan.
 *
 * Under, not over. The question is what the human opened the window for and keeps
 * the top of the document; the ground it stands on is what they read next, if
 * they need it.
 */
export function append(doc: string, section: string): string {
  const body = strip(doc);
  if (!section) return body;
  return `${body.replace(/\n*$/, "")}\n\n---\n\n${section}`;
}

/**
 * An earlier copy of this, and the rule relay put above it, cut back out — so
 * that a document which has been through relay once and is being sent again does
 * not go up with a round-old plan under a current one.
 *
 * Two things have to be true of a heading before the rest of the document is cut
 * off after it, because a document *about* this feature quotes the section and
 * relay eating the rest of SPEC.md would be worse than any duplicate. It must be
 * the last such heading with nothing but its own section after it — a quotation
 * has the document it is explaining underneath it — and it must not be inside a
 * fenced code block, which is where both SPEC.md and README.md show one.
 */
export function strip(doc: string): string {
  const lines = doc.split("\n");
  let at = -1;
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && (line === heading || line.startsWith(`${heading} — `))) at = i;
  }
  if (at < 0) return doc;

  let end = at;
  const blank = () => end > 0 && lines[end - 1]!.trim() === "";
  while (blank()) end--;
  if (end > 0 && lines[end - 1]!.trim() === "---") end--;
  while (blank()) end--;
  return lines.slice(0, end).join("\n") + "\n";
}

/** `1st`, `2nd`, `3rd`, `4th` — how the line reads it out loud. */
function nth(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
}

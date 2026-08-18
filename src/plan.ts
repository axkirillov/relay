import { mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

import { name, note, taskDir } from "./task.ts";

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
 * Neither of those can be derived. relay listed the rounds of the task under the
 * document first — every question it had asked, and what became of each — and a
 * list of what was asked is a record of the conversation, not of the work: it says
 * nothing about what is still to do, and a document's own first line is a poor
 * summary of why it exists. So this is written rather than derived: the agent puts
 * a short overview and a to-do list in the task's `plan.md` at the start, keeps
 * the list ticked as it goes, and relay carries whatever is in that file under
 * every document of the task.
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
 * Which round of the task the plan is older than: the first round that went up
 * after the agent last wrote it, counting this document's own as the next one, or
 * 0 when no round has gone up since.
 *
 * A plan is a to-do list that is only worth anything while it is true, and the
 * agent is told to update it before every relay. Whether it did is not a matter of
 * opinion — a round went up, and the file was not touched — and the document is
 * the only place that can say so, because the human is the one being asked to
 * trust it.
 *
 * A tie is not stale. A plan written in the same second a round went up was
 * written for that round as far as anything here can tell, and a borderline case
 * should not accuse.
 */
export function stale(plan: Plan, past: Date[]): number {
  const at = past.findIndex((when) => when > plan.written);
  return at < 0 ? 0 : at + 1;
}

/**
 * The section as markdown, or nothing at all when there is no plan. No heading
 * over an absence: a document from a tool that does not keep plans should look
 * exactly as it did before this existed.
 *
 * `past` is when each earlier round of the task went up — its length is which
 * round this document is, and its times are what says whether the plan has kept
 * up with them.
 */
export function render(task: string, plan: Plan | null, past: Date[], now: Date): string {
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
  lines.push("", `${nth(past.length + 1)} round of this task. ${where}`);

  // And when the time on that line is old enough to matter, saying it in a way
  // that does not need arithmetic. A whole round has gone by without the agent
  // touching this, so the list is at best what the work looked like then — which
  // is the one thing the human cannot see for themselves, and the one thing that
  // decides how much of the section to believe.
  const behind = stale(plan, past);
  if (behind) lines.push(`**Not touched since before the ${nth(behind)} round — it may be behind the work.**`);
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

/**
 * How the last line spells a time and a path.
 *
 * It is the one line relay writes for a human to read rather than for a program
 * to parse, and nothing else in relay needs either of these, so they live beside
 * the line rather than with the task they are about.
 */

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A time, as a document says it. Clock time, not "20 minutes ago": the document is
 * kept, and a document that says "20 minutes ago" is wrong by the time anybody
 * reads it back. The date comes with it only when it is not today's — a task
 * answered inside an afternoon should not repeat the date every time.
 */
export function clock(when: Date, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `${p(when.getHours())}:${p(when.getMinutes())}`;
  const sameDay =
    when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth() && when.getDate() === now.getDate();
  return sameDay ? time : `${months[when.getMonth()]} ${when.getDate()} ${time}`;
}

/**
 * Whether there is a checkout at this path, which is the same question as whether
 * `taskOf` found one or fell through to the directory it was given — and so
 * whether the heading has a task to name.
 */
export function rooted(task: string): boolean {
  try {
    statSync(join(task, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** `~` for the human's home, since that is how the rest of the document spells it. */
export function tilde(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? "~" + path.slice(home.length) : path;
}

/** `1st`, `2nd`, `3rd`, `4th` — how the line reads it out loud. */
function nth(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
}

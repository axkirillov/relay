import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";

import { filledFile, relayHome, tasksDir } from "./paths.ts";

/**
 * What has already been asked, under what is being asked now.
 *
 * The spec's first rule is that the human knows *nothing* about the task except
 * what relay has shown them. Taken seriously, that is an obligation on every
 * document and not just the first: the fifth question of a task arrives to
 * someone who answered four others hours ago, in a window that closed each time,
 * with a black box in between. So relay writes the account itself — the rounds
 * of this task, when they went up, and what became of each — under the document
 * the agent sent, on every relay.
 *
 * It is plain text in the document rather than a panel beside it, which means the
 * human can read it in the rendered view, open any round of it with `gf`, strike
 * a line out of it, and write into it — and anything they write there comes back
 * in the diff like every other edit. There is nothing new to learn and nothing
 * protected.
 */

/** How many rounds a document carries. The rest are counted, not listed. */
export const shown = 12;

/** relay's own heading, and half of what finds an earlier copy of this. */
const heading = "## The task so far";

/** The line that says where the rounds are, and the other half of that. */
const where = "Each round is a directory in ";

export type Outcome =
  /** Accepted with edits — they said something. */
  | "answered"
  /** Accepted untouched. */
  | "accepted as written"
  /** The window was closed on it, with the document in front of them. */
  | "closed without a reply"
  /** The window was closed while it was still in line, so they never saw it. */
  | "never reached the screen"
  /** On screen, in line, or a relay that died — no answer either way. */
  | "no answer";

export type Round = {
  id: string;
  /** When the document went up, read off the name the round already carries. */
  when: Date;
  /** What it was about: the document's own first line. */
  label: string;
  outcome: Outcome;
};

/**
 * The task a relay belongs to.
 *
 * relay does not know what a task is; that word is composer's, and the human's.
 * What it has is the directory it was run from, and the one thing about that
 * directory that tracks a piece of work: the worktree it sits in. One task is one
 * worktree — which is how the human names them too, the branch and the tmux
 * session and the directory all carrying the one name.
 *
 * The walk stops at the first `.git`, whether that is a directory or the file a
 * worktree has instead; both mean "the root of this checkout". With none above at
 * all — an agent relaying from `/tmp` — the directory itself is the task. That
 * groups nothing, which is the right failure: better a timeline with one round in
 * it than a timeline of four unrelated agents.
 */
export function taskOf(cwd: string): string {
  for (let dir = cwd; ; ) {
    try {
      statSync(join(dir, ".git"));
      return dir;
    } catch {
      const up = dirname(dir);
      if (up === dir) return cwd;
      dir = up;
    }
  }
}

/**
 * Say that this round was part of this task.
 *
 * A round's directory is named for its timestamp and its document, and nothing in
 * that name says which task it belonged to. Working it out afterwards means
 * reading every `meta.json` under `~/.relay`, which on a few hundred rounds is
 * half a second — half a second in front of every document, spent on a question
 * the relay itself could have answered for free while it had the answer. So each
 * relay leaves its own name in its task's directory, and a task's rounds are a
 * listing from then on.
 *
 * A symlink to the round rather than a file about it: nothing a timeline says is
 * kept here, so there is no second copy of anything to go stale — and the task's
 * directory is then the task, walkable. It is the one path a document has to name,
 * and `gf` on it opens a listing where every round is a directory to step into.
 *
 * Rounds, plural, because filling the ledger in files hundreds at a time and the
 * directory is the same directory for all of them: one relay says one round, and
 * that is this with a list of one.
 */
export function note(task: string, ...ids: string[]): void {
  const dir = taskDir(task);
  try {
    mkdirSync(dir, { recursive: true });
    // The path it stands for, since the directory's name is a shortening of it.
    writeFileSync(join(dir, "task"), task + "\n");
  } catch {
    // A ledger that will not be written costs a timeline, and a timeline is not
    // worth a relay. The document still goes up.
    return;
  }
  for (const id of ids) {
    try {
      symlinkSync(join(relayHome(), id), join(dir, id));
    } catch {
      // Already filed, most likely — which is what makes filling in the ledger
      // something that can be interrupted and simply done again.
    }
  }
}

/**
 * Every round already on disk, filed under the task it was relayed from.
 *
 * The ledger is written a round at a time, by the relay that opens the round —
 * which means that on the day this ships it is empty, and every task in flight
 * has a timeline that starts at zero. The human would land the feature and see
 * nothing: not on this relay, because it is the first noted round of its task,
 * and on the next one only the one round in between. A hundred answered
 * questions would be behind them and none of them said.
 *
 * They do not have to be lost. A round records the directory it was relayed from,
 * so the task it belonged to is `taskOf` of that — the same answer the relay
 * would have written down at the time, worked out afterwards from what it kept.
 * So the ledger is filled in once, from every round in `~/.relay`, and after that
 * each relay notes its own and nothing rereads anything.
 *
 * Once, not once per task: the marker is the ledger's, not the task's. Otherwise
 * a genuinely new task pays for a scan that can only tell it what it already
 * knows — that it has no history — and pays again on the next new task, and the
 * next. And a marker rather than the directory merely existing, because by the
 * time this runs the directory may already hold the few rounds that were noted
 * between the feature landing and this: filing them again is a no-op, and losing
 * the nine hundred behind them would not be.
 */
export function fill(home = relayHome()): void {
  const marker = filledFile();
  try {
    statSync(marker);
    return;
  } catch {
    // Not filled in yet, or not readable — either way, do it and find out.
  }

  let ids: string[];
  try {
    ids = readdirSync(home).filter((id) => /^\d{8}-\d{6}-/.test(id));
  } catch {
    // No rounds to file, which the marker should still say, so that a first
    // relay on a fresh machine does not go looking again on the second.
    ids = [];
  }

  // Grouped before anything is written, because both halves of the work repeat
  // otherwise: a task's directory would be created once per round it holds, and
  // the walk to a worktree root once per round relayed from it. Hundreds of
  // rounds share a few dozen directories between them, and the whole of this is
  // time spent in front of a document.
  const tasks = new Map<string, string[]>();
  const roots = new Map<string, string>();
  for (const id of ids) {
    let cwd: string | undefined;
    try {
      cwd = (JSON.parse(readFileSync(join(home, id, "meta.json"), "utf8")) as { cwd?: string }).cwd;
    } catch {
      // A round from before relay recorded where it was run, or one whose meta
      // will not parse: there is nothing that says which task it was, and a
      // guess would be worse than the omission.
    }
    if (!cwd) continue;
    let root = roots.get(cwd);
    if (root === undefined) roots.set(cwd, (root = taskOf(cwd)));
    const held = tasks.get(root);
    if (held) held.push(id);
    else tasks.set(root, [id]);
  }
  for (const [root, held] of tasks) note(root, ...held);

  try {
    mkdirSync(relayHome(), { recursive: true });
    writeFileSync(marker, `${ids.length}\n`);
  } catch {
    // Unwritable: the filing above still stands, and the next relay redoes it.
    // Idempotent, so that costs a scan and changes nothing.
  }
}

/**
 * The task's own directory: what the human calls the task, and six characters of
 * the full path's hash.
 *
 * Both halves are needed. The name is in a document the human reads, so it has to
 * be the task they know — `relay-task-timeline`, not a hash and not the whole path
 * mangled to a line of its own. And two checkouts really can end in the same two
 * segments, so the name alone would quietly pour two tasks into one directory,
 * which is the one failure this feature cannot have.
 */
export function taskDir(task: string): string {
  const short = name(task).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "task";
  const hash = createHash("sha256").update(task).digest("hex").slice(0, 6);
  return join(tasksDir(), `${short}-${hash}`);
}

/**
 * The rounds of a task that came before this one, oldest first, and how many
 * there are in all.
 *
 * The listing is the whole of the search — no directory outside this task is
 * opened — and only the rounds that will be listed are read. A task with a
 * hundred rounds behind it costs a listing and a dozen small files.
 */
export function before(task: string, limit = shown, home = relayHome()): { rounds: Round[]; total: number } {
  let ids: string[];
  try {
    ids = readdirSync(taskDir(task))
      .filter((name) => /^\d{8}-\d{6}-/.test(name))
      .sort();
  } catch {
    // No such task directory: this is the first relay of it.
    return { rounds: [], total: 0 };
  }

  // Backwards from the newest, until there are enough to list. Backwards because
  // it is the recent rounds a document wants under it, and until-enough rather
  // than the last N names because a round the human has since deleted should cost
  // the timeline nothing — not the slot it used to be in.
  const rounds: Round[] = [];
  for (let i = ids.length - 1; i >= 0 && rounds.length < limit; i--) {
    const round = read(ids[i]!, home);
    if (round) rounds.push(round);
  }
  return { rounds: rounds.reverse(), total: ids.length };
}

/**
 * One round, read from its own directory.
 *
 * Nothing here is fatal: a round whose directory the human has since deleted is
 * left out of the timeline rather than allowed to stop the relay that was going
 * to show it.
 */
export function read(id: string, home = relayHome()): Round | null {
  const dir = join(home, id);
  let sent: string;
  try {
    sent = readFileSync(join(dir, "sent.md"), "utf8");
  } catch {
    return null;
  }

  let meta: { accepted?: string; abandoned?: string; shown?: boolean } = {};
  try {
    meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as typeof meta;
  } catch {
    // A round with no readable meta is a round nothing is known about the end of.
  }

  const answered = !!meta.accepted;
  return {
    id,
    when: opened(id),
    label: label(sent) || words(id),
    outcome: answered ? (edited(dir) ? "answered" : "accepted as written") : ended(meta),
  };
}

/**
 * The timeline, as markdown, or nothing at all when this is the task's first
 * round. A heading over an empty list would be a paragraph saying "no history",
 * which is not worth the room on a document that has none.
 */
export function render(task: string, rounds: Round[], total: number, now: Date): string {
  if (!rounds.length) return "";

  // The name only when there is a task to name. A relay run from a directory with
  // no checkout above it — an agent in its own scratchpad — is its own task, and
  // the rounds under it really are one session's, but what it would be called is
  // the directory it ran in: a session's UUID. The heading is there to tell the
  // human which piece of work a document belongs to, and a UUID does not, so
  // saying nothing is the more truthful of the two.
  //
  // Statting for the checkout is right here because the task being rendered is
  // always the one this relay is in, whose directory is on disk as we ask. A task
  // whose worktree the human tore down months ago keeps its name — nothing renders
  // its heading, and if anything did, the name is what it should say.
  const lines = [`${heading}${rooted(task) ? ` — ${name(task)}` : ""}`, ""];
  for (const round of rounds) {
    lines.push(`- **${clock(round.when, now)}** ${round.label} — ${round.outcome}`);
  }

  // One line for where the rounds are, rather than a path on every entry. A path
  // is the longest thing on a line and the least of what the line says: it wrapped
  // every entry onto three rows and read as the loudest part of each. Here it is
  // said once, and `gf` on it opens the task as a directory of its rounds.
  const said = `${where}\`${tilde(taskDir(task))}/\`.`;
  const earlier = total - rounds.length;
  lines.push("", earlier > 0 ? `The last ${rounds.length} of ${total}. ${said}` : said);
  return lines.join("\n") + "\n";
}

/**
 * The document as it goes on screen: what the agent wrote, then a rule, then the
 * timeline.
 *
 * Under, not over. The question is what the human opened the window for and it
 * keeps the top of the document; the account of how they got here is what they
 * read next, if they need it.
 *
 * A timeline already in the document is replaced rather than joined, because
 * there is one way for it to be there — an agent relaying a document that came
 * back out of `~/.relay` — and two timelines, one of them a round out of date,
 * is worse than either.
 */
export function append(doc: string, section: string): string {
  const body = strip(doc);
  if (!section) return body;
  return `${body.replace(/\n*$/, "")}\n\n---\n\n${section}`;
}

/**
 * An earlier copy of this, and the rule relay put above it, cut back out.
 *
 * The heading alone is not enough to go on: a document *about* this feature quotes
 * it, and cutting the rest of SPEC.md off because it shows what a timeline looks
 * like would be relay eating a document it was asked to show. So what follows the
 * heading has to be a timeline and nothing else — entries, blank lines, and the
 * line saying where the rounds are — which is true of one relay wrote and false of
 * one being talked about.
 */
function strip(doc: string): string {
  const lines = doc.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith(heading) && only(lines.slice(i + 1))) at = i;
  }
  if (at < 0) return doc;

  let end = at;
  const blank = () => end > 0 && lines[end - 1]!.trim() === "";
  while (blank()) end--;
  if (end > 0 && lines[end - 1]!.trim() === "---") end--;
  while (blank()) end--;
  return lines.slice(0, end).join("\n") + "\n";
}

/** Whether these lines are the rest of a timeline, and nothing else. */
function only(rest: string[]): boolean {
  return rest.every((line) => {
    const text = line.trim();
    return text === "" || text.startsWith("- **") || text.startsWith(where) || /^The last \d+ of \d+\. /.test(text);
  });
}

/**
 * What the document is about, off the top of it — the heading if it opens with
 * one, otherwise its first line of prose. Markdown's own punctuation is dropped:
 * it is how the line is written, not part of what it says, and a timeline entry
 * is one line of a list already.
 */
export function label(doc: string): string {
  for (const raw of doc.split("\n")) {
    const line = raw.trim();
    // A rule, or the fence of a frontmatter block, says nothing about the
    // document; the line worth having is under it.
    if (!line || /^(-{3,}|={3,}|\*{3,})$/.test(line)) continue;
    const text = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^>\s*/, "")
      .replace(/[*_`]/g, "")
      .trim();
    if (text) return text.length > 60 ? text.slice(0, 59).trimEnd() + "…" : text;
  }
  return "";
}

/**
 * How a round ended without an answer. A round dismissed while it was still in
 * line was never declined — they never saw it — and the two are worth telling
 * apart on a line that is otherwise going to read as a refusal. Rounds recorded
 * before relay kept that apart say nothing about it, and the common case is the
 * one they get.
 */
function ended(meta: { abandoned?: string; shown?: boolean }): Outcome {
  if (!meta.abandoned) return "no answer";
  return meta.shown === false ? "never reached the screen" : "closed without a reply";
}

/** Whether the human changed anything, which is what the patch has a hunk for. */
function edited(dir: string): boolean {
  try {
    return /^@@/m.test(readFileSync(join(dir, "diff.patch"), "utf8"));
  } catch {
    return false;
  }
}

/** The stamp a round is named for, back as a time. */
export function opened(id: string): Date {
  const [y, m, d, hh, mm, ss] = [
    id.slice(0, 4),
    id.slice(4, 6),
    id.slice(6, 8),
    id.slice(9, 11),
    id.slice(11, 13),
    id.slice(13, 15),
  ].map(Number) as [number, number, number, number, number, number];
  return new Date(y, m - 1, d, hh, mm, ss);
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The time a round went up. Clock time, not "20 minutes ago": the document is
 * kept, and a document that says "20 minutes ago" is wrong by the time anybody
 * reads it back. The date comes with it only when it is not today's — a task
 * answered inside an afternoon should not repeat the date a dozen times.
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
 * `taskOf` found one or fell through to the directory it was given.
 */
export function rooted(task: string): boolean {
  try {
    statSync(join(task, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** The task, said the way the human says it: the worktree and the repo above it. */
export function name(task: string): string {
  return task.split(sep).filter(Boolean).slice(-2).join("/") || task;
}

/** `~` for the human's home, since that is how the rest of the document spells it. */
export function tilde(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? "~" + path.slice(home.length) : path;
}

/** A round with nothing in its document to name it falls back to its own name. */
function words(id: string): string {
  return id.slice(16).replace(/-/g, " ") || id;
}

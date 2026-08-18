import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

import { filledFile, relayHome, tasksDir } from "./paths.ts";

/**
 * Which task a relay belongs to, and what that task has been through.
 *
 * The spec's first rule is that the human knows *nothing* about the task except
 * what relay has shown them. Taken seriously, that is an obligation on every
 * document and not just the first: the fifth question of a task arrives to
 * someone who answered four others hours ago, in a window that closed each time,
 * with a black box in between.
 *
 * What relay puts above the document to answer that is the task's plan — the
 * agent's own overview and to-do list, in `plan.ts`. This half is the ground it
 * stands on: which task a directory belongs to, where that task keeps its things,
 * and when each of its rounds went up. The plan is written; this is counted.
 *
 * The ledger is a directory per task holding a symlink per round. Nothing the
 * plan says is copied into it, so there is nothing here to fall out of step with
 * anything — and the task is a directory the human can walk, which is what lets a
 * document name one path and have `gf` open the plan, the rounds, and everything
 * each round kept.
 */

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
 * groups nothing, which is the right failure: better one session's own plan than
 * one plan shared out between four unrelated agents.
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
 * A symlink to the round rather than a file about it: nothing said under a
 * document is kept here, so there is no second copy of anything to go stale — and
 * the task's directory is then the task, walkable. It is the one path a document
 * has to name, and `gf` on it opens a listing with the plan in it and every round
 * a directory to step into.
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
    // A ledger that will not be written costs the count of rounds under a
    // document, and that is not worth a relay. The document still goes up.
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
 * which means that on the day this ships it is empty, and every task in flight is
 * counting from zero. The human would land the feature and be told, on the
 * hundredth question of a task they have been at for two days, that this is its
 * first round; and the plan they are shown would say it was written before a
 * history that relay claims never happened.
 *
 * Those rounds do not have to be lost. A round records the directory it was
 * relayed from, so the task it belonged to is `taskOf` of that — the same answer
 * the relay would have written down at the time, worked out afterwards from what
 * it kept. So the ledger is filled in once, from every round in `~/.relay`, and
 * after that each relay notes its own and nothing rereads anything.
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
    ids = readdirSync(home).filter((id) => stamped(id));
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
 * When each round of this task went up, oldest first — the rounds before this
 * one, since a relay notes its own only once its document is stored.
 *
 * Two things are read off this and nothing else is: how many rounds the task has
 * had, which is the count, and whether the plan under the document has been
 * touched since the work moved, which is the times. Both come out of the listing
 * alone — the time a round went up is in the name it already carries, so a task a
 * hundred rounds deep costs one `readdir` and not one file read.
 *
 * A round the human has since deleted keeps its place here. Its name is the whole
 * of what this reads, and it happened whether or not its directory is still on
 * disk.
 */
export function rounds(task: string): Date[] {
  try {
    return readdirSync(taskDir(task)).filter(stamped).sort().map(opened);
  } catch {
    // No such task directory: this is the first relay of it.
    return [];
  }
}

/** Whether a name is a round's — a stamp, then what the document was called. */
function stamped(name: string): boolean {
  return /^\d{8}-\d{6}-/.test(name);
}

/** The stamp a round is named for, back as a time. */
function opened(id: string): Date {
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

/** The task, said the way the human says it: the worktree and the repo above it. */
export function name(task: string): string {
  return task.split(sep).filter(Boolean).slice(-2).join("/") || task;
}

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tasksDir } from "./paths.ts";
import { taskDir } from "./task.ts";

/**
 * The one session whose documents you want first.
 *
 * The line is arrival and nothing else, which is right when every relay is worth
 * the same. It is wrong the moment they are not: four agents can be waiting at
 * once, and the one the human is actually working with waits behind three they
 * were going to skim. What the human asked for is a way to say *this one first* —
 * and then to stop thinking about it, which is why this is a mark that stays put
 * rather than something to redo per document.
 *
 * Marked on the task, which is to say the worktree. That is what the human means
 * by a session: one worktree, one branch, one tmux session, one agent, all
 * carrying the one name. The session's own id would have been the narrower
 * answer and the wrong one — it changes when they restart the agent, and the
 * priority would quietly go with it, on the session they most likely restarted
 * *because* it was the one that mattered.
 *
 * A file in the task's directory in the round ledger, present or absent. That
 * directory is already the task, walkable and named the way the human names it,
 * so the mark sits with the rounds it reorders and is `rm`-able by hand. Nothing
 * reads it but `enter`, once, as the relay joins the line.
 */

/** The mark's file. Its presence is the whole of the state. */
function file(task: string): string {
  return join(taskDir(task), "priority");
}

/** Is this task's next document to go in front of everyone else's? */
export function marked(task: string): boolean {
  try {
    statSync(file(task));
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark this task, or take the mark back. Idempotent both ways: the human says
 * which state they want, not which change to make, so saying it twice is not a
 * toggle back to where they started.
 *
 * Throws if it cannot be written — the human ran this to change something, and a
 * command that says nothing while changing nothing is the one outcome worth an
 * error.
 */
export function mark(task: string, on: boolean): void {
  const path = file(task);
  if (!on) {
    try {
      rmSync(path);
    } catch {
      // Not marked, so already what they asked for.
    }
    return;
  }
  const dir = taskDir(task);
  mkdirSync(dir, { recursive: true });
  // What the directory's shortened name stands for, as the ledger writes it —
  // this may be the first thing that ever creates it.
  try {
    writeFileSync(join(dir, "task"), task + "\n");
  } catch {}
  writeFileSync(path, "");
}

/**
 * Every task marked right now, as the paths they are.
 *
 * Read off the ledger rather than kept as a list: the mark is a file in a task's
 * directory, so the set of them is a listing and there is no second copy of it to
 * fall out of step. Each directory says which path it stands for, since its own
 * name is a shortening of one.
 *
 * This is what `--priority` prints back. A mark stays until it is taken back, and
 * one left on from yesterday reorders everything the human does today — from any
 * other session it would be invisible, so setting the mark is also when the whole
 * of it is said out loud.
 */
export function all(): string[] {
  let names: string[];
  try {
    names = readdirSync(tasksDir());
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const name of names) {
    const dir = join(tasksDir(), name);
    try {
      statSync(join(dir, "priority"));
      out.push(readFileSync(join(dir, "task"), "utf8").trim());
    } catch {
      // Unmarked, or a directory from before the ledger wrote what it stands
      // for — either way there is no path here to name.
    }
  }
  return out.filter(Boolean).sort();
}

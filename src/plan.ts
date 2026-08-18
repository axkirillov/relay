import { mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";

import { plansDir } from "./paths.ts";
import { taskDir } from "./task.ts";

/**
 * Where the task's plan is, and whether the agent has kept it current.
 *
 * relay used to render it above every document. composer draws it now — a band over
 * the document column that folds — so all that is left here is the path `--plan`
 * prints and the two facts the stderr lines are worth.
 */

/** What the agent writes, and when it last wrote it. */
export type Plan = {
  text: string;
  /** Its mtime — the one honest answer to "is this still true?". */
  written: Date;
};

/**
 * The task's plan file, under composer's `~/.task/plans/`. The name is the same slug
 * relay's round ledger uses for the task, so the two are findable side by side.
 */
export function file(task: string): string {
  return join(plansDir(), `${basename(taskDir(task))}.md`);
}

/**
 * The path, ready to be written to — the answer to `relay --plan`, kept working so
 * that an agent told the old flag still lands on the file composer reads.
 */
export function open(task: string): string {
  try {
    mkdirSync(plansDir(), { recursive: true });
  } catch {
    // `--plan` still says where it would go, and the agent's own write will fail
    // with a better message than anything invented here.
  }
  return file(task);
}

/** The plan as it stands, or nothing when the task has none. */
export function read(task: string): Plan | null {
  const path = file(task);
  try {
    const text = readFileSync(path, "utf8").trim();
    // Opened and never written: absent rather than empty.
    if (!text) return null;
    return { text, written: statSync(path).mtime };
  } catch {
    return null;
  }
}

/**
 * Which round of the task the plan is older than: the first round that went up after
 * the agent last wrote it, counting this document's own as the next one, or 0 when no
 * round has gone up since.
 *
 * A tie is not stale. A plan written in the same second a round went up was written
 * for that round as far as anything here can tell.
 */
export function stale(plan: Plan, past: Date[]): number {
  const at = past.findIndex((when) => when > plan.written);
  return at < 0 ? 0 : at + 1;
}

/** `~` for the human's home, since that is how the rest of the line spells it. */
export function tilde(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? "~" + path.slice(home.length) : path;
}

import { mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";

import { aboutDir } from "./paths.ts";
import { taskDir } from "./task.ts";

/**
 * Where the task's answer is — what this session is about — and whether the agent has
 * kept it current.
 *
 * relay used to render it above every document. composer draws it now, as a card the
 * human raises with ⌘P and sees at no other time, so all that is left here is the path
 * `--about` prints and the two facts the stderr lines are worth.
 */

/** What the agent writes, and when it last wrote it. */
export type About = {
  text: string;
  /** Its mtime — the one honest answer to "is this still true?". */
  written: Date;
};

/**
 * The task's answer file, under composer's `~/.task/about/`. The name is the same slug
 * relay's round ledger uses for the task, so the two are findable side by side.
 */
export function file(task: string): string {
  return join(aboutDir(), `${basename(taskDir(task))}.md`);
}

/**
 * The path, ready to be written to — what `relay --about` prints. It has to be the
 * very path `composer --about` prints, and the slug on both sides is the same six
 * hex of the same sha256 for exactly that reason.
 */
export function open(task: string): string {
  try {
    mkdirSync(aboutDir(), { recursive: true });
  } catch {
    // `--about` still says where it would go, and the agent's own write will fail
    // with a better message than anything invented here.
  }
  return file(task);
}

/** The answer as it stands, or nothing when the task has none. */
export function read(task: string): About | null {
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
 * Which round of the task the answer is older than: the first round that went up after
 * the agent last wrote it, counting this document's own as the next one, or 0 when no
 * round has gone up since.
 *
 * A tie is not stale. An answer written in the same second a round went up was written
 * for that round as far as anything here can tell.
 */
export function stale(about: About, past: Date[]): number {
  const at = past.findIndex((when) => when > about.written);
  return at < 0 ? 0 : at + 1;
}

/** `~` for the human's home, since that is how the rest of the line spells it. */
export function tilde(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? "~" + path.slice(home.length) : path;
}

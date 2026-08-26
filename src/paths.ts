import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Everything relay keeps between processes lives here. `RELAY_QUEUE_DIR` is the
 * one handle a test needs to move a whole relay somewhere private, so the rest
 * of the layout follows it rather than being overridable piece by piece.
 */
export function relayHome(): string {
  const q = process.env.RELAY_QUEUE_DIR;
  return q ? dirname(q) : join(homedir(), ".relay");
}

export function rehearsing(): boolean {
  return Boolean(process.env.RELAY_QUEUE_DIR);
}

/** A ticket per relay in line. */
export function queueDir(): string {
  return process.env.RELAY_QUEUE_DIR || join(relayHome(), "queue");
}

/** Written by the window while it is up, and by nobody else. */
export function windowFile(): string {
  return join(relayHome(), "window.json");
}

/**
 * When the human last closed the window. A relay that started before that is
 * dismissed by it — which is what makes closing the window durable rather than
 * something each relay has to have been watching at the right moment to catch.
 */
export function closedFile(): string {
  return join(relayHome(), "closed");
}

/**
 * Tasks' own home, which is composer's rather than relay's: the hook lives there and
 * so does the answer a document used to carry. relay reads it for `--about` alone.
 *
 * `RELAY_QUEUE_DIR` moves it, as it moves everything else here, so a rehearsal cannot
 * point an agent at the human's real ones.
 */
export function taskHome(): string {
  const q = process.env.RELAY_QUEUE_DIR;
  return q ? join(dirname(q), "task") : join(homedir(), ".task");
}

/**
 * A file per task holding the answer the agent writes by hand — what this session is
 * about, and only that. composer draws it, on ⌘P and not otherwise.
 *
 * `about/`, and it was `plans/` while the file was a plan. This is the one path the
 * two repos have to spell identically — composer's `aboutDir()` is the same line —
 * so the rename only held because both were rebuilt together and the files already
 * on disk were moved in the same breath.
 */
export function aboutDir(): string {
  return join(taskHome(), "about");
}

/**
 * Which rounds belong to which task — a directory per task, holding an empty
 * file per round. It is a grouping and nothing else: what a round *contains*
 * stays in the round's own directory, so there is no second copy of anything
 * here to fall out of step with the first.
 */
export function tasksDir(): string {
  return join(relayHome(), "tasks");
}

/**
 * Whether the ledger has been filled in from the rounds that were relayed before
 * relay kept one — something done once in the life of an install.
 *
 * Beside the directory rather than in it, because `tasks/` holds tasks and nothing
 * else: it is named in a document, the human opens it with `gf`, and a listing of
 * their tasks should not have relay's bookkeeping sitting in it.
 */
export function filledFile(): string {
  return join(relayHome(), "tasks.filled");
}

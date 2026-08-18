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

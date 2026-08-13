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

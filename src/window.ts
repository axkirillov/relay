import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { lastClose, screenHeld } from "./presence.js";
import type { Turn } from "./queue.js";

const require = createRequire(import.meta.url);
const shell = fileURLToPath(new URL("./shell.cjs", import.meta.url));

const pollMs = 250;
/**
 * How long a spawn is given to become a window before another is tried. Electron
 * takes about a second to write its presence file, and every tick until then
 * still reads "no window". The shell's single-instance lock catches what slips
 * through; this is what stops it having to.
 */
const bootMs = 5_000;

/**
 * Start the window, unless one is already up.
 *
 * Detached, because it is not this relay's window. It stays after this relay has
 * been answered, shows whatever is next in line, and quits on its own once the
 * line is empty — which is also what stops a killed relay from leaving a window
 * behind it on the screen forever.
 */
function ensureWindow(debug: boolean): void {
  if (screenHeld()) return;
  const electron: string = require("electron");
  const child = spawn(electron, [shell], {
    detached: true,
    stdio: debug ? ["ignore", "inherit", "inherit"] : "ignore",
  });
  child.unref();
}

export type Screen = {
  /** Resolves once the human has closed the window on this relay. */
  closed: Promise<void>;
  /**
   * Was this the document on screen when they closed it? Read from what the
   * window wrote as it went, not from what this relay managed to catch: a
   * document can arrive and be closed between two polls, and a relay guessing
   * from what it saw would tell the agent it was read when it never appeared.
   */
  shown(): boolean;
  stop(): void;
};

/**
 * Keep this relay's document on the screen, and notice when the human takes it
 * away. One poll does both, because they are one question asked from either
 * side: is there a window, and should there be.
 *
 * The close is read first, every tick. A relay reaching the head in the same
 * instant the human closes must not answer by starting the window back up, and
 * reading the tombstone before deciding to spawn is what makes that impossible
 * rather than unlikely.
 *
 * Attended from the moment this relay joins the line, not from when it reaches
 * the head: closing the window dismisses everyone waiting on it, so a document
 * that never got to the screen is listening for exactly what the one being read
 * is listening for.
 *
 * The window is restarted as well as started. One that dies violently leaves no
 * tombstone, and the relay at the head simply puts another up on the next tick —
 * which the old spawn-once-on-reaching-the-head could not do.
 *
 * `start` is false for the blank the window itself puts up when the line runs
 * dry. It takes a screen that is already there and must never make one: a window
 * that died would otherwise be replaced within the second by an empty document
 * nobody asked for. It still watches for the close, because that is what tells
 * it to go.
 */
export function attend(turn: Turn, url: string, debug: boolean, start = true): Screen {
  let settle: () => void;
  const closed = new Promise<void>((resolve) => {
    settle = resolve;
  });

  let mine = false;
  let shown = false;
  let stopped = false;
  let spawnedAt = 0;

  function tick() {
    if (stopped) return;

    const close = lastClose();
    if (close.at > turn.since) {
      shown = close.url === url;
      stop();
      return settle();
    }

    if (!start || !mine || screenHeld()) return;
    if (Date.now() - spawnedAt < bootMs) return;
    spawnedAt = Date.now();
    ensureWindow(debug);
  }

  const timer = setInterval(tick, pollMs);
  timer.unref();

  function stop() {
    stopped = true;
    clearInterval(timer);
  }

  // Reaching the head is the moment this document should be on the screen.
  // Sitting out the rest of a poll first is a quarter second of nothing.
  void turn.wait().then(() => {
    mine = true;
    tick();
  });

  return { closed, shown: () => shown, stop };
}

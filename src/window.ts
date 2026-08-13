import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { screenHeld } from "./presence.js";

const require = createRequire(import.meta.url);
const shell = fileURLToPath(new URL("./shell.cjs", import.meta.url));

const pollMs = 250;

/**
 * Start the window, unless one is already up.
 *
 * Detached, because it is not this relay's window. It stays after this relay has
 * been answered, shows whatever is next in line, and quits on its own once the
 * line is empty — which is also what stops a killed relay from leaving a window
 * behind it on the screen forever.
 *
 * Only the relay at the head of the line calls this, so two cannot race. If one
 * ever did, the shell's single-instance lock makes the loser exit rather than
 * become a second window.
 */
export function ensureWindow(debug: boolean): void {
  if (screenHeld()) return;
  const electron: string = require("electron");
  const child = spawn(electron, [shell], {
    detached: true,
    stdio: debug ? ["ignore", "inherit", "inherit"] : "ignore",
  });
  child.unref();
}

export type Watch = {
  /** Resolves once a window has been up, and is not any more. */
  gone: Promise<void>;
  /**
   * The same question, asked now rather than waited on. Reaching the head of the
   * line and the window being closed can land in the same instant, and the relay
   * that reads a stale answer here is the one that reopens a window the human
   * has just shut.
   */
  dismissed(): boolean;
  stop(): void;
};

/**
 * Notice the window going.
 *
 * Closing it dismisses every relay in line, not only the one on screen, so a
 * relay still waiting its turn watches for this exactly as the one being read
 * does. Polling rather than waiting on a child: the window belongs to no
 * particular relay, and a window that is killed outright has no chance to say so.
 *
 * Gone only counts once a window has been seen. Before the first one is up there
 * is nothing there, and that is not a dismissal.
 */
export function watchWindow(): Watch {
  let settle: () => void;
  const gone = new Promise<void>((resolve) => {
    settle = resolve;
  });

  let seen = false;
  const look = () => {
    if (screenHeld()) {
      seen = true;
      return false;
    }
    return seen;
  };

  const timer = setInterval(() => {
    if (!look()) return;
    clearInterval(timer);
    settle();
  }, pollMs);
  timer.unref();

  return { gone, dismissed: look, stop: () => clearInterval(timer) };
}

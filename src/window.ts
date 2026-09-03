import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { rehearsing } from "./paths.ts";
import { lastClose, screenHeld } from "./presence.ts";
import type { Turn } from "./queue.ts";

const require = createRequire(import.meta.url);
const shell = fileURLToPath(new URL("./shell.cjs", import.meta.url));

const pollMs = 250;
const bootMs = 5_000;

export function shouldOpen(): boolean {
  return !screenHeld() && !rehearsing();
}

function ensureWindow(debug: boolean): void {
  if (!shouldOpen()) return;
  const electron: string = require("electron");
  const child = spawn(electron, [shell], {
    detached: true,
    stdio: debug ? ["ignore", "inherit", "inherit"] : "ignore",
  });
  child.unref();
}

export type Screen = {
  closed: Promise<void>;
  shown(): boolean;
  stop(): void;
};

export function attend(turn: Turn, url: string, debug: boolean): Screen {
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

    if (!mine || screenHeld()) return;
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

  void turn.wait().then(() => {
    mine = true;
    tick();
  });

  return { closed, shown: () => shown, stop };
}

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const shell = fileURLToPath(new URL("../shell/main.cjs", import.meta.url));

export type Window = {
  /** Resolves when the window is gone, however it went. */
  closed: Promise<void>;
  close(): Promise<void>;
};

export function openWindow(url: string, debug: boolean): Window {
  const electron: string = require("electron");
  const child: ChildProcess = spawn(electron, [shell, url], {
    stdio: debug ? ["ignore", "inherit", "inherit"] : "ignore",
  });

  const closed = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });

  return {
    closed,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const hard = setTimeout(() => child.kill("SIGKILL"), 2000);
      await closed;
      clearTimeout(hard);
    },
  };
}

import { chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { maxOutputBytes } from "./run.ts";

const require = createRequire(import.meta.url);

type Pty = {
  pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
};
type Module = {
  spawn(file: string, args: string[], opt: Record<string, unknown>): Pty;
};

export type Ended = { code: number | null; stopped: boolean; capped: boolean };

export type Session = {
  replay(): string;
  attach(onData: (chunk: string) => void, onExit: (ended: Ended) => void): () => void;
  write(data: string): void;
  resize(cols: number): void;
  stop(): void;
  ended: Ended | null;
};

export const rows = 24;

export function interactive(command: string, cwd: string, cols: number): Session {
  const shell = process.env.SHELL || "/bin/sh";
  const pty = load().spawn(shell, ["-c", command], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: env(),
  });

  const listeners = new Set<{ data: (chunk: string) => void; exit: (ended: Ended) => void }>();
  const back: string[] = [];
  let bytes = 0;
  let stopped = false;
  let capped = false;

  const signal = (sig: "SIGHUP" | "SIGKILL") => {
    try {
      process.kill(-pty.pid, sig);
    } catch {
      try {
        pty.kill(sig);
      } catch {
      }
    }
  };

  const session: Session = {
    ended: null,
    replay: () => back.join(""),
    attach(onData, onExit) {
      const entry = { data: onData, exit: onExit };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    write(data) {
      if (!session.ended) pty.write(data);
    },
    resize(c) {
      if (!session.ended) pty.resize(Math.max(1, c), rows);
    },
    stop() {
      if (session.ended || stopped) return;
      stopped = true;
      signal("SIGHUP");
      setTimeout(() => {
        if (!session.ended) signal("SIGKILL");
      }, 1000).unref();
    },
  };

  pty.onData((chunk) => {
    if (capped) return;
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxOutputBytes) {
      capped = true;
      signal("SIGKILL");
      return;
    }
    back.push(chunk);
    for (const l of listeners) l.data(chunk);
  });

  pty.onExit(({ exitCode, signal: sig }) => {
    session.ended = { code: stopped || capped || sig ? null : exitCode, stopped: stopped || (!capped && !!sig), capped };
    for (const l of listeners) l.exit(session.ended);
  });

  return session;
}

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("RELAY_")) out[k] = v;
  }
  out.TERM = "xterm-256color";
  out.COLORTERM = "truecolor";
  return out;
}

function load(): Module {
  const module = require("node-pty") as Module;
  if (process.platform !== "win32") executable();
  return module;
}

function executable() {
  const lib = dirname(require.resolve("node-pty"));
  const dirs = [`../prebuilds/${process.platform}-${process.arch}`, "../build/Release", "../build/Debug"];
  for (const dir of dirs) {
    const helper = join(lib, dir, "spawn-helper");
    try {
      const { mode } = statSync(helper);
      if (!(mode & 0o111)) chmodSync(helper, (mode & 0o7777) | 0o111);
      return;
    } catch {
    }
  }
}

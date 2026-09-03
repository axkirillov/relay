import { chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

type Pty = {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};
type Module = {
  spawn(file: string, args: string[], opt: Record<string, unknown>): Pty;
};

export type Session = {
  program: string;
  cwd: string;
  alive: boolean;
  replay(): string;
  attach(onData: (chunk: string) => void, onExit: (code: number) => void): () => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

const maxReplay = 1 << 18;

export function open(cwd: string, cols: number, rows: number): Session {
  return run(process.env.SHELL || "/bin/bash", login(), cwd, cols, rows);
}

export function run(file: string, args: string[], cwd: string, cols: number, rows: number): Session {
  const pty = load().spawn(file, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: env(),
  });

  const listeners = new Set<{ data: (chunk: string) => void; exit: (code: number) => void }>();
  const back: string[] = [];
  let held = 0;
  const session: Session = {
    program: file,
    cwd,
    alive: true,
    replay: () => back.join(""),
    attach(onData, onExit) {
      const entry = { data: onData, exit: onExit };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    write: (data) => session.alive && pty.write(data),
    resize(c, r) {
      if (session.alive) pty.resize(Math.max(1, c), Math.max(1, r));
    },
    kill() {
      if (!session.alive) return;
      session.alive = false;
      pty.kill();
    },
  };

  pty.onData((chunk) => {
    back.push(chunk);
    held += chunk.length;
    while (held > maxReplay && back.length > 1) held -= back.shift()!.length;
    for (const l of listeners) l.data(chunk);
  });

  pty.onExit(({ exitCode }) => {
    session.alive = false;
    for (const l of listeners) l.exit(exitCode);
  });

  return session;
}

function login(): string[] {
  return process.platform === "darwin" ? ["-l"] : [];
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

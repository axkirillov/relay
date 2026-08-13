import { chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Structural, so a native module need not be a type dependency of the build. */
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
  /** What the shell has said so far, for a page that arrives after it started. */
  replay(): string;
  /** Listen; the returned function stops listening. */
  attach(onData: (chunk: string) => void, onExit: (code: number) => void): () => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

// Enough to hold a screenful of scrollback across a reload, not enough for a
// runaway command to matter.
const maxReplay = 1 << 18;

/**
 * A shell on a pty, in the directory the relay was run from.
 *
 * It lives in this process rather than the window because the page is sandboxed
 * — no node integration, no native modules — and that is the good outcome: the
 * CLI is plain node, so node-pty loads the prebuild for the system ABI and
 * nothing has to be rebuilt against Electron's.
 */
export function open(cwd: string, cols: number, rows: number): Session {
  return run(process.env.SHELL || "/bin/bash", login(), cwd, cols, rows);
}

/**
 * Any program on a pty of its own — nvim, when the human follows a path out of
 * the document.
 *
 * The program is the pty's own child rather than something a shell was asked to
 * run, which is the whole difference: what it does when it exits is end, and the
 * pane it was in can go with it. A shell in between would still be there,
 * holding a prompt in a pane that was meant to disappear.
 */
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

/**
 * macOS terminals hand you a login shell, and the human's PATH is often only
 * assembled in the profile a login shell reads. Elsewhere the interactive rc is
 * enough and `-l` would be the odd one out.
 */
function login(): string[] {
  return process.platform === "darwin" ? ["-l"] : [];
}

/**
 * The shell's own environment, minus relay's. A relay run from this pane would
 * otherwise inherit the switches of the round it was started inside — serving
 * with no window under `RELAY_NO_OPEN`, prefilling from a file that is not its
 * own — and appear to hang.
 */
function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("RELAY_")) out[k] = v;
  }
  out.TERM = "xterm-256color";
  out.COLORTERM = "truecolor";
  return out;
}

/**
 * node-pty, late and by require, for two reasons. It is the one part of relay
 * that can be missing without the document going with it — a machine with no
 * working prebuild should still get its question answered — and an import would
 * make loading it the price of starting up at all.
 */
function load(): Module {
  const module = require("node-pty") as Module;
  if (process.platform !== "win32") executable();
  return module;
}

/**
 * node-pty publishes its prebuilt `spawn-helper` without the executable bit —
 * the tarball has it 0644 — and every fork fails with `posix_spawnp failed`
 * until something puts it back. Cheaper to set it here than to make installing
 * relay depend on a C toolchain.
 */
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
      // Not where this one is; try the next.
    }
  }
}

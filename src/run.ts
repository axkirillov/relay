import { spawn } from "node:child_process";

/**
 * A command the human ran from inside the window.
 *
 * Run-and-capture, not a terminal: stdin is closed, so a command that asks a
 * question is answered with end-of-file rather than hanging on a prompt nobody
 * can see. stdout and stderr are merged in arrival order, because that is the
 * order they happened in and the human is reading them as one stream.
 */

/** Past this the document would be growing without end; say so and stop. */
export const maxOutputBytes = 256 << 10;

export type Running = {
  /** Ends it — the human's ⌃C, or the relay shutting down around it. */
  kill(): void;
  /** Resolves when the command is over and its last output has been written. */
  done: Promise<void>;
};

export function start(command: string, cwd: string, write: (text: string) => void): Running {
  // The human's own shell, but not a login one. relay is launched by the agent,
  // so this process already holds the environment the agent works in — the PATH
  // that found `pnpm` for it will find `pnpm` here. Re-reading a login profile
  // could only pull the two apart, and would tip any banner in it into the
  // document as output.
  const shell = process.env.SHELL || "/bin/sh";
  // Its own process group, so stopping it stops what it started. A SIGTERM to
  // `sh -c "pnpm test"` need never reach pnpm; a signal to the group reaches
  // everything the command spawned.
  const child = spawn(shell, ["-c", command], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let bytes = 0;
  let capped = false;
  let stopped = false;

  const signal = (sig: "SIGTERM" | "SIGKILL") => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      // Gone between the check and the signal, or the group already reaped.
      child.kill(sig);
    }
  };

  const take = (text: string) => {
    if (capped) return;
    bytes += Buffer.byteLength(text);
    if (bytes > maxOutputBytes) {
      capped = true;
      write(`\n… output passed ${maxOutputBytes >> 10} KB — the command was stopped here\n`);
      signal("SIGKILL");
      return;
    }
    write(text);
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", take);
  child.stderr.on("data", take);

  const done = new Promise<void>((resolve) => {
    // `error` fires instead of `close` when the shell itself cannot be spawned.
    child.once("error", (err) => {
      write(`relay could not run it: ${err.message}\n`);
      resolve();
    });
    child.once("close", (code, sig) => {
      if (capped) return resolve();
      if (stopped || sig) write("\n[stopped]\n");
      else if (code) write(`\n[exit ${code}]\n`);
      resolve();
    });
  });

  return {
    kill() {
      stopped = true;
      signal("SIGTERM");
      setTimeout(() => signal("SIGKILL"), 2000).unref();
    },
    done,
  };
}

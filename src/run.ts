import { spawn } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";

/**
 * A command the human ran from inside the window.
 *
 * Run-and-capture, not a terminal: stdin is closed, so a command that asks a
 * question is answered with end-of-file rather than hanging on a prompt nobody
 * can see. stdout and stderr are merged in arrival order, because that is the
 * order they happened in and the human is reading them as one stream.
 */

/**
 * Past this the command is stopped. It bounds the disk and this process now
 * rather than the document — the document has its own, much smaller bound below,
 * so a command has to be truly runaway to reach this one.
 */
export const maxOutputBytes = 8 << 20;

/**
 * What the document keeps of an output too long to hold: the first lines of it
 * and the last.
 *
 * The start says what the command set out to do and the end says how it turned
 * out, which between them is usually the whole answer. The middle is what nobody
 * reads unless something is wrong — and for that the file has all of it.
 *
 * Bytes as well as lines, because one line of minified javascript would flood
 * the document on its own and never reach a hundred of anything.
 */
export const headLines = 100;
export const tailLines = 20;
export const maxDocBytes = 64 << 10;

export type Running = {
  /** Ends it — the human's ⌃C, or the relay shutting down around it. */
  kill(): void;
  /** Resolves when the command is over and its last output has been written. */
  done: Promise<void>;
};

/**
 * `logPath` is where the output goes if it outgrows the document. The file is
 * opened only if that happens, so an ordinary short run leaves nothing behind.
 */
export function start(
  command: string,
  cwd: string,
  write: (text: string) => void,
  logPath: string,
): Running {
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
  let ended = false;

  let lines = 0;
  let shown = 0;
  let shownBytes = 0;
  let partial = "";
  // Held until the output turns out to be long enough to need a file, and gone
  // the moment it is.
  let held = "";
  let log: number | null = null;

  // The end of the output, kept back so it can be shown below the part the
  // document did not get.
  const tail: string[] = [];
  let tailBytes = 0;

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

  /** The file gets every byte as it arrived: it is the copy of record. */
  const keep = (chunk: string) => {
    if (ended) return;
    if (log === null) held += chunk;
    else writeSync(log, chunk);
  };

  const spill = () => {
    log = openSync(logPath, "w");
    writeSync(log, held);
    held = "";
    // Named here rather than at the end, because ⌃C ends the response: without
    // this the human would be left holding a cut-off block and no file to go to.
    write(`\n… long output — all of it is in ${tilde(logPath)}\n`);
  };

  const remember = (text: string) => {
    tail.push(text);
    tailBytes += text.length + 1;
    // Always one line, however long that line is; `cut` deals with the length.
    while (tail.length > tailLines || (tail.length > 1 && tailBytes > maxDocBytes)) {
      tailBytes -= tail.shift()!.length + 1;
    }
  };

  const line = (text: string, terminated: boolean) => {
    lines++;
    const chunk = terminated ? `${text}\n` : text;
    if (log === null && (lines > headLines || shownBytes + chunk.length > maxDocBytes)) spill();
    if (log === null) {
      shown++;
      shownBytes += chunk.length;
      write(chunk);
    }
    remember(text);
  };

  const take = (text: string) => {
    if (capped) return;
    bytes += Buffer.byteLength(text);
    keep(text);
    if (bytes > maxOutputBytes) {
      capped = true;
      // Killed for its size, so the file is the only place the output survives —
      // even if it never grew past the document's own bounds in lines.
      if (log === null) spill();
      write(`\n… output passed ${maxOutputBytes >> 20} MB — the command was stopped here\n`);
      signal("SIGKILL");
      return;
    }

    partial += text;
    for (let cut = partial.indexOf("\n"); cut >= 0; cut = partial.indexOf("\n")) {
      line(partial.slice(0, cut), true);
      partial = partial.slice(cut + 1);
    }
  };

  /** What the document was not given, and the last of what it was. */
  const rest = () => {
    // The document's head and this tail can overlap when an output only just
    // outgrew it; the head saw those lines already.
    const end = tail.slice(Math.max(0, shown - (lines - tail.length)));
    if (!end.length) return;
    const hidden = lines - shown - end.length;
    write(
      hidden > 0
        ? `\n… ${hidden.toLocaleString("en-US")} more lines there. The last ${end.length}:\n`
        : "\n",
    );
    write(`${end.map(cut).join("\n")}\n`);
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", take);
  child.stderr.on("data", take);

  const done = new Promise<void>((resolve) => {
    const over = () => {
      ended = true;
      if (log !== null) closeSync(log);
      resolve();
    };
    // `error` fires instead of `close` when the shell itself cannot be spawned.
    child.once("error", (err) => {
      write(`relay could not run it: ${err.message}\n`);
      over();
    });
    child.once("close", (code, sig) => {
      if (partial) line(partial, false);
      if (capped) return over();
      if (log !== null) rest();
      if (stopped || sig) write("\n[stopped]\n");
      else if (code) write(`\n[exit ${code}]\n`);
      over();
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

/** A line with no business being in a document at all. */
function cut(text: string): string {
  return text.length > maxDocBytes
    ? `${text.slice(0, maxDocBytes)}… (line cut here — the file has it whole)`
    : text;
}

function tilde(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

import { spawn } from "node:child_process";
import { closeSync, openSync, readSync, truncateSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { StringDecoder } from "node:string_decoder";

// `.ts`, unlike the bundle's own `.js` specifiers: run.ts is loaded straight by
// node in its test, and node resolves what is written.
import { spillNotice } from "./spill.ts";

/**
 * A command the human ran from inside the window.
 *
 * Run-and-capture, not a terminal: stdin is closed, so a command that asks a
 * question is answered with end-of-file rather than hanging on a prompt nobody
 * can see. stdout and stderr are merged in arrival order, because that is the
 * order they happened in and the human is reading them as one stream.
 *
 * The command writes to a file and this reads that file back. A pipe would be
 * the obvious way round, and it was — but a pipe has this process on the other
 * end of it, and a command the human left running when they accepted would die
 * of `SIGPIPE` the moment the relay exited. A running child's descriptors cannot
 * be reassigned after the fact, so the file has to be where the output was going
 * all along.
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

/**
 * How often the file is read for what the command has added to it.
 *
 * The human is watching the output arrive, so this is the delay between a line
 * being written and being seen. A read of a local file at rest costs one
 * syscall that returns nothing.
 */
const pollMs = 50;

export type Running = {
  /** Ends it — the human's ⌃C, or the relay shutting down around it. */
  kill(): void;
  /**
   * Lets go of it, alive.
   *
   * The human accepted with this still running, which is them saying they would
   * rather answer now than wait. Nothing here reads it again: its output is
   * going to a file it holds open itself, and the document has been told where
   * that file is.
   */
  detach(): void;
  /** Resolves when the command is over — or when it has been let go of. */
  done: Promise<void>;
};

/**
 * `logPath` is where the output goes. Every run writes it, because it is what
 * the command's stdout is; a run that ends in the window without outgrowing the
 * document takes it away again on the way out, so an ordinary short run still
 * leaves nothing behind.
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
  const out = openSync(logPath, "w");
  // Its own process group, so stopping it stops what it started. A SIGTERM to
  // `sh -c "pnpm test"` need never reach pnpm; a signal to the group reaches
  // everything the command spawned.
  const child = spawn(shell, ["-c", command], {
    cwd,
    stdio: ["ignore", out, out],
    detached: true,
  });
  // The child has its own copy from the moment it was spawned, and this side
  // never writes to it.
  closeSync(out);

  const rfd = openSync(logPath, "r");
  const buf = Buffer.allocUnsafe(64 << 10);
  // A read ends where the buffer does, which can be halfway through a character;
  // the decoder holds those bytes back until the rest of them arrive.
  const decoder = new StringDecoder("utf8");
  /** How far into the file this has read. The read is positional, so this is the truth. */
  let at = 0;

  let bytes = 0;
  let capped = false;
  let stopped = false;
  let detached = false;
  let spilled = false;

  let lines = 0;
  let shown = 0;
  let shownBytes = 0;
  let partial = "";

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

  /** The output stops going into the document here, and the file is named instead. */
  const spill = () => {
    spilled = true;
    // Named the moment the document stops keeping up rather than at the end,
    // because ⌃C ends the response: without this the human would be left holding
    // a cut-off block and no file to go to.
    write(`\n${spillNotice(tilde(logPath))}\n`);
  };

  /** Nothing points at this file and nothing needs it: take it away again. */
  const discard = () => {
    try {
      unlinkSync(logPath);
    } catch {
      // Already gone, or never made.
    }
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
    if (!spilled && (lines > headLines || shownBytes + chunk.length > maxDocBytes)) spill();
    if (!spilled) {
      shown++;
      shownBytes += chunk.length;
      write(chunk);
    }
    remember(text);
  };

  const take = (text: string, size: number) => {
    if (capped) return;
    bytes += size;
    if (bytes > maxOutputBytes) {
      capped = true;
      // Killed for its size, so the file is the only place the output survives —
      // even if it never grew past the document's own bounds in lines.
      if (!spilled) spill();
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

  /** Everything the command has written since the last look. */
  const drain = () => {
    while (!capped && !detached) {
      let n = 0;
      try {
        n = readSync(rfd, buf, 0, buf.length, at);
      } catch {
        return;
      }
      if (n <= 0) return;
      at += n;
      take(decoder.write(buf.subarray(0, n)), n);
    }
  };

  const timer = setInterval(drain, pollMs);

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

  let over!: () => void;
  const done = new Promise<void>((resolve) => {
    let settled = false;
    over = () => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      try {
        closeSync(rfd);
      } catch {
        // Already closed.
      }
      resolve();
    };
  });

  // `error` fires instead of `close` when the shell itself cannot be spawned.
  child.once("error", (err) => {
    write(`relay could not run it: ${err.message}\n`);
    discard();
    over();
  });
  child.once("close", (code, sig) => {
    // Let go of at the accept. There is nobody to write to and the file is the
    // whole point of it now.
    if (detached) return;
    drain();
    const last = decoder.end();
    if (last) take(last, Buffer.byteLength(last));
    if (partial) line(partial, false);
    if (capped) {
      // The disk's bound is this file's size, so it is made true here rather
      // than hoped for: the kill is not instant, and a command writing to a
      // file has no pipe to fill up and be slowed by.
      try {
        truncateSync(logPath, maxOutputBytes);
      } catch {
        // Gone, or never grown that far.
      }
      return over();
    }
    if (spilled) rest();
    else discard();
    if (stopped || sig) write("\n[stopped]\n");
    else if (code) write(`\n[exit ${code}]\n`);
    over();
  });

  return {
    kill() {
      stopped = true;
      signal("SIGTERM");
      setTimeout(() => signal("SIGKILL"), 2000).unref();
    },
    detach() {
      if (detached) return;
      detached = true;
      // The relay is on its way out and node leaves when nothing is left to do:
      // a child still counted would hold it here until the command ended, which
      // is the wait the human just declined.
      child.unref();
      over();
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

export function tilde(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

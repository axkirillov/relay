import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readSync, rmSync, truncateSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { spillNotice } from "./spill.ts";

export const maxOutputBytes = 8 << 20;

export const tailLines = 20;
export const maxDocBytes = 64 << 10;

export const defaultScreenLines = 100;

const leastWorthSpilling = tailLines + 3;

const pollMs = 50;

export type Running = {
  kill(): void;
  detach(): void;
  done: Promise<void>;
};

export function start(
  command: string,
  cwd: string,
  write: (text: string) => void,
  logPath: string,
  screenLines: number = defaultScreenLines,
): Running {
  const headLines = Math.max(screenLines, leastWorthSpilling);

  const shell = process.env.SHELL || "/bin/sh";
  const out = openSync(logPath, "w");
  const child = spawn(shell, ["-c", command], {
    cwd,
    stdio: ["ignore", out, out],
    detached: true,
  });
  closeSync(out);

  const rfd = openSync(logPath, "r");
  const buf = Buffer.allocUnsafe(64 << 10);
  const decoder = new StringDecoder("utf8");
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

  const tail: string[] = [];
  let tailBytes = 0;

  const signal = (sig: "SIGTERM" | "SIGKILL") => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      child.kill(sig);
    }
  };

  const spill = () => {
    spilled = true;
    write(`\n${spillNotice(tilde(logPath))}\n`);
  };

  const discard = () => {
    try {
      unlinkSync(logPath);
    } catch {
    }
  };

  const remember = (text: string) => {
    tail.push(text);
    tailBytes += text.length + 1;
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

  const rest = () => {
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
      }
      resolve();
    };
  });

  child.once("error", (err) => {
    write(`relay could not run it: ${err.message}\n`);
    discard();
    over();
  });
  child.once("close", (code, sig) => {
    if (detached) return;
    drain();
    const last = decoder.end();
    if (last) take(last, Buffer.byteLength(last));
    if (partial) line(partial, false);
    if (capped) {
      try {
        truncateSync(logPath, maxOutputBytes);
      } catch {
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
      child.unref();
      over();
    },
    done,
  };
}

function cut(text: string): string {
  return text.length > maxDocBytes
    ? `${text.slice(0, maxDocBytes)}… (line cut here — the file has it whole)`
    : text;
}

export function tilde(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

let scratch: string | null = null;

export function scratchDir(): string {
  if (scratch) return scratch;
  const dir = mkdtempSync(join(tmpdir(), "relay-read-"));
  scratch = dir;

  const sweep = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
    }
  };
  process.once("exit", sweep);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      sweep();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }

  return dir;
}

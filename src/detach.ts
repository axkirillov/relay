import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { relayHome } from "./paths.ts";

const pollMs = 100;

export function spoolOf(): string | undefined {
  return process.env.RELAY_SPOOL || undefined;
}

export function clientOf(): number | undefined {
  const pid = Number(process.env.RELAY_CLIENT);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export async function detach(args: string[]): Promise<number> {
  const home = join(relayHome(), "spool");
  mkdirSync(home, { recursive: true });
  const spool = mkdtempSync(join(home, `${process.pid}-`));

  const server = await start(spool, args).catch((err: Error) => {
    process.stderr.write(`relay: cannot start the window's server: ${err.message}\n`);
    return undefined;
  });
  if (!server) {
    rmSync(spool, { recursive: true, force: true });
    return 2;
  }

  return follow(spool, server);
}

function start(spool: string, args: string[]): Promise<number> {
  const script = '"$@" >"$RELAY_SPOOL/out" 2>"$RELAY_SPOOL/err" </dev/null & echo $!';
  const child = spawn("/bin/sh", ["-c", script, "relay", process.execPath, ...process.execArgv, realpathSync(process.argv[1]!), ...args], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, RELAY_SPOOL: spool, RELAY_CLIENT: String(process.pid) },
  });

  return new Promise((resolve, reject) => {
    let printed = "";
    child.stdout.on("data", (chunk: Buffer) => (printed += chunk.toString()));
    child.on("error", reject);
    child.on("close", () => {
      const pid = Number(printed.trim());
      if (Number.isInteger(pid) && pid > 0) resolve(pid);
      else reject(new Error(`the shell printed no pid: ${JSON.stringify(printed)}`));
    });
  });
}

async function follow(spool: string, server: number): Promise<number> {
  const err = join(spool, "err");
  const code = join(spool, "code");
  let read = 0;

  const pass = () => {
    read += copy(err, read, process.stderr);
  };

  for (;;) {
    pass();
    if (existsSync(code)) break;
    if (!running(server)) {
      if (existsSync(code)) break;
      pass();
      rmSync(spool, { recursive: true, force: true });
      process.stderr.write("relay: the window's server ended without an answer\n");
      return 1;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  pass();
  const out = join(spool, "out");
  if (existsSync(out)) process.stdout.write(readFileSync(out));
  const exit = Number(readFileSync(code, "utf8").trim());
  rmSync(spool, { recursive: true, force: true });
  return Number.isInteger(exit) ? exit : 1;
}

function copy(file: string, from: number, to: NodeJS.WriteStream): number {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return 0;
  }
  try {
    const buf = Buffer.alloc(64 * 1024);
    let total = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, from + total);
      if (n <= 0) break;
      to.write(buf.subarray(0, n));
      total += n;
    }
    return total;
  } finally {
    closeSync(fd);
  }
}

export function reportTo(spool: string, client: number | undefined): void {
  process.once("exit", (exit) => {
    if (client !== undefined && running(client)) {
      try {
        writeFileSync(join(spool, "code"), `${exit}\n`);
        return;
      } catch {}
    }
    rmSync(spool, { recursive: true, force: true });
  });
}

export function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

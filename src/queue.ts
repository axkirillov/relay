import { mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const pollMs = 250;
const beatMs = 2000;
const staleMs = 10_000;

export type Turn = {
  /** Relays already in line when this one joined. */
  ahead: number;
  /** Resolves once every relay ahead of this one is done. */
  wait(): Promise<void>;
  leave(): void;
};

/**
 * There is one human and one screen, so only one window may be up at a time.
 * With no daemon to hold a queue, the queue is a directory: one ticket file per
 * waiting relay, named for its arrival, and the oldest live ticket has the
 * screen. Everyone polls; nobody holds a lock that could go stale.
 */
export function enter(id: string, source: string): Turn {
  const dir = queueDir();
  mkdirSync(dir, { recursive: true });

  const since = Date.now();
  const name = `${since}-${process.pid}.json`;
  const mine = join(dir, name);
  const ticket = JSON.stringify({ pid: process.pid, id, source, since }) + "\n";
  writeFileSync(mine, ticket);

  // A PID can be recycled onto an unrelated process, which would wedge the
  // queue behind a relay that no longer exists. A ticket nobody is touching is
  // how the others tell the difference.
  const beat = setInterval(() => touch(mine), beatMs);
  beat.unref();

  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    clearInterval(beat);
    try {
      rmSync(mine);
    } catch {}
  };

  process.once("exit", leave);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      leave();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }

  return {
    ahead: line(dir).filter((t) => t.name !== name).length,
    leave,
    async wait() {
      for (;;) {
        const waiting = line(dir);
        // Our ticket only vanishes if something outside took it; put it back
        // under its original name so we keep the place we queued for.
        if (!gone && !waiting.some((t) => t.name === name)) writeFileSync(mine, ticket);
        const head = waiting[0];
        if (!head || head.name === name) return;
        await sleep(pollMs);
      }
    },
  };
}

type Ticket = { name: string; at: number; pid: number };

/** Every live ticket, oldest first. Tickets of dead relays are swept as found. */
function line(dir: string): Ticket[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const live: Ticket[] = [];
  for (const name of names) {
    const m = /^(\d+)-(\d+)\.json$/.exec(name);
    if (!m) continue;
    const t = { name, at: Number(m[1]), pid: Number(m[2]) };
    if (alive(dir, t)) live.push(t);
    else
      try {
        rmSync(join(dir, name));
      } catch {}
  }

  return live.sort((a, b) => a.at - b.at || a.pid - b.pid);
}

function alive(dir: string, t: Ticket): boolean {
  if (t.pid === process.pid) return true;
  try {
    process.kill(t.pid, 0);
  } catch (err) {
    // EPERM means the PID is taken by someone we may not signal — alive enough.
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  try {
    return Date.now() - statSync(join(dir, t.name)).mtimeMs < staleMs;
  } catch {
    return false;
  }
}

function touch(file: string) {
  const now = new Date();
  try {
    utimesSync(file, now, now);
  } catch {}
}

function queueDir(): string {
  return process.env.RELAY_QUEUE_DIR || join(homedir(), ".relay", "queue");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

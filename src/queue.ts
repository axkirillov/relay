import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Named by the file that is really there, not by the `.js` the bundle would
// emit: the tests run this module through node as it stands.
import { alive, heartbeat } from "./live.ts";
import { queueDir } from "./paths.ts";

const pollMs = 250;

export type Turn = {
  /** Relays ahead of this one in line when it joined. */
  ahead: number;
  /**
   * How many relays are waiting behind this one, as of now. Read while the
   * human is looking at the document, so it is counted afresh every time rather
   * than remembered from when this relay joined: the line grows and shrinks
   * under them while they read.
   */
  behind(): number;
  /** When this relay joined the line. What a dismissal is measured against. */
  since: number;
  /** Say where this relay's document can be read, so the window can show it. */
  serving(url: string): void;
  /** Resolves once every relay ahead of this one is done. */
  wait(): Promise<void>;
  leave(): void;
};

/** A relay in line, as everyone else sees it. */
export type Waiting = {
  name: string;
  at: number;
  pid: number;
  id?: string;
  source?: string;
  /** Where its document is served. Absent for the moment before it is up. */
  url?: string;
};

/**
 * There is one human, one screen, and one window. With no daemon to hold a
 * queue, the line is a directory: one ticket file per relay, named for its
 * arrival, and the oldest live ticket is the one the window is showing.
 * Everyone polls; nobody holds a lock that could go stale.
 */
export function enter(id: string, source: string): Turn {
  const dir = queueDir();
  mkdirSync(dir, { recursive: true });

  const since = Date.now();
  const name = `${since}-${process.pid}.json`;
  const mine = join(dir, name);

  // Everything the ticket says, kept here because one of them changes while the
  // relay is in line: where it is served.
  const fields: Record<string, unknown> = { pid: process.pid, id, source, since };
  // Rewritten when that changes, so keep the current text: a ticket taken out
  // from under us has to go back as it was, url and all.
  let ticket = body();
  writeFileSync(mine, ticket);

  const stop = heartbeat(mine);

  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    stop();
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
    ahead: Math.max(0, line(dir).findIndex((t) => t.name === name)),
    since,
    leave,
    behind() {
      const waiting = line(dir);
      const mine = waiting.findIndex((t) => t.name === name);
      // Somebody has taken our ticket and `wait` has not put it back yet. There
      // is no place to count from, and a number counted from nowhere is worse
      // than no number at all.
      if (mine < 0) return 0;
      return waiting.length - mine - 1;
    },
    serving(url) {
      fields.url = url;
      rewrite();
    },
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

  function body(): string {
    return JSON.stringify(fields) + "\n";
  }

  function rewrite(): void {
    if (gone) return;
    ticket = body();
    try {
      writeFileSync(mine, ticket);
    } catch {}
  }
}

/**
 * Every relay in line, oldest first — the one that should be on screen is the
 * one that has been waiting longest. Tickets of relays that are gone are swept.
 */
export function line(dir = queueDir()): Waiting[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const live: Waiting[] = [];
  for (const name of names) {
    const m = /^(\d+)-(\d+)\.json$/.exec(name);
    if (!m) continue;
    const file = join(dir, name);
    const t: Waiting = { name, at: Number(m[1]), pid: Number(m[2]) };
    if (!alive(file, t.pid)) {
      try {
        rmSync(file);
      } catch {}
      continue;
    }
    // A ticket being written as it is read is a torn read, not a dead relay —
    // it keeps its place and the next poll picks up the rest of it.
    try {
      const { id, source, url } = JSON.parse(readFileSync(file, "utf8"));
      if (typeof id === "string") t.id = id;
      if (typeof source === "string") t.source = source;
      if (typeof url === "string") t.url = url;
    } catch {}
    live.push(t);
  }

  return live.sort((a, b) => a.at - b.at || a.pid - b.pid);
}

function sleep(ms: number): Promise<void> {
  // Unref'd: a poll should never be the reason a process is still running. A
  // relay dismissed while still in line exits now, not at the end of a tick.
  return new Promise((r) => void setTimeout(r, ms).unref());
}

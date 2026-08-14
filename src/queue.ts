import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Named by the file that is really there, not by the `.js` the bundle would
// emit: the tests run this module through node as it stands.
import { alive, heartbeat } from "./live.ts";
import { queueDir } from "./paths.ts";

const pollMs = 250;

/**
 * Where in the line a relay belongs, before arrival is even looked at.
 *
 * - `top` — a task the human made. It is the one thing that jumps: they asked
 *   for it just now, in front of the document they were reading.
 * - `normal` — every agent's document. FIFO among themselves, as they always
 *   were.
 * - `idle` — the blank the window puts up when nothing else wants the screen. It
 *   holds the screen only for want of anyone else, so it sorts last and yields
 *   the instant something arrives.
 */
export type Rank = "top" | "normal" | "idle";

const ranks: Record<Rank, number> = { top: 0, normal: 1, idle: 2 };

function ranked(r: unknown): Rank {
  return r === "top" || r === "idle" ? r : "normal";
}

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
  /**
   * The human typed in it, so it is a task they meant to write rather than the
   * blank they were offered — and a document with their words in it does not
   * lose the screen to a document that has just arrived.
   */
  promote(): void;
  /** Resolves once every relay ahead of this one is done. */
  wait(): Promise<void>;
  leave(): void;
};

/** A relay in line, as everyone else sees it. */
export type Waiting = {
  name: string;
  at: number;
  pid: number;
  rank: Rank;
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
export function enter(id: string, source: string, rank: Rank = "normal"): Turn {
  const dir = queueDir();
  mkdirSync(dir, { recursive: true });

  const since = Date.now();
  const name = `${since}-${process.pid}.json`;
  const mine = join(dir, name);

  // Everything the ticket says, kept here because two of them change while the
  // relay is in line — where it is served, and whether the human has made it
  // theirs.
  const fields: Record<string, unknown> = { pid: process.pid, id, source, since, rank };
  // Rewritten as those change, so keep the current text: a ticket taken out
  // from under us has to go back as it was, url and rank and all.
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
    // Where this relay actually stands, not how many others there are: a task
    // the human just made has a line behind it rather than in front of it.
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
      // The blank is never one of them: it holds the screen for want of anyone
      // else and yields the moment it is wanted, so it is not something the
      // human has left to answer.
      return waiting.slice(mine + 1).filter((t) => t.rank !== "idle").length;
    },
    serving(url) {
      fields.url = url;
      rewrite();
    },
    promote() {
      fields.rank = "top";
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
 * Every relay in line, the one that should be on screen first. Rank decides
 * before arrival does; tickets of relays that are gone are swept.
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
    const t: Waiting = { name, at: Number(m[1]), pid: Number(m[2]), rank: "normal" };
    if (!alive(file, t.pid)) {
      try {
        rmSync(file);
      } catch {}
      continue;
    }
    // A ticket being written as it is read is a torn read, not a dead relay —
    // it keeps its place and the next poll picks up the rest of it.
    try {
      const { id, source, url, rank } = JSON.parse(readFileSync(file, "utf8"));
      if (typeof id === "string") t.id = id;
      if (typeof source === "string") t.source = source;
      if (typeof url === "string") t.url = url;
      t.rank = ranked(rank);
    } catch {}
    live.push(t);
  }

  return live.sort((a, b) => {
    if (a.rank !== b.rank) return ranks[a.rank] - ranks[b.rank];
    // Among tasks the human made, the newest: pressing the key again is asking
    // for a fresh document, and being handed the one already half-written would
    // be the opposite of that. Everyone else keeps the order they arrived in.
    if (a.rank === "top") return b.at - a.at || b.pid - a.pid;
    return a.at - b.at || a.pid - b.pid;
  });
}

function sleep(ms: number): Promise<void> {
  // Unref'd: a poll should never be the reason a process is still running. A
  // relay dismissed while still in line exits now, not at the end of a tick.
  return new Promise((r) => void setTimeout(r, ms).unref());
}

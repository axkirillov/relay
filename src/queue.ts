import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Named by the file that is really there, not by the `.js` the bundle would
// emit: the tests run this module through node as it stands.
import { alive, beatMs, touch } from "./live.ts";
import { queueDir } from "./paths.ts";
import { marked } from "./priority.ts";

const pollMs = 250;

/**
 * Where in the line a relay belongs, before arrival is looked at.
 *
 * - `top` — a document from the session the human has marked as the priority
 *   one. It goes in front of everything an unmarked session sends, however long
 *   that has been waiting.
 * - `normal` — everyone else. Arrival among themselves, as they always were.
 *
 * Worked out as the line is read, not written on the ticket as the relay joins.
 * The human marks a session from the window, looking at a row that is *already
 * waiting* — so the mark has to move the document they can see, and a rank
 * stamped at arrival would only ever have moved the next one. It costs a `stat`
 * per ticket per poll and buys a mark that takes effect the instant it is made.
 *
 * The word is composer's too: it reads a ticket, ranks it the same way off the
 * same file, and shows what it finds at the head.
 */
export type Rank = "top" | "normal";

const ranks: Record<Rank, number> = { top: 0, normal: 1 };

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
  /** Read off the mark as this was read, not off the ticket. */
  rank: Rank;
  id?: string;
  source?: string;
  /**
   * The session this document came from — the worktree the relay was run in.
   * What the mark is on, so this is what says whether the mark is on this.
   */
  task?: string;
  /** Where its document is served. Absent for the moment before it is up. */
  url?: string;
};

/**
 * There is one human, one screen, and one window. With no daemon to hold a
 * queue, the line is a directory: one ticket file per relay, named for its
 * arrival, and the oldest live ticket of the highest rank is the one the window
 * is showing. Everyone polls; nobody holds a lock that could go stale.
 */
export function enter(id: string, source: string, task: string): Turn {
  const dir = queueDir();
  mkdirSync(dir, { recursive: true });

  const since = Date.now();
  const name = `${since}-${process.pid}.json`;
  const mine = join(dir, name);

  // Everything the ticket says, kept here because one of them changes while the
  // relay is in line: where it is served.
  const fields: Record<string, unknown> = { pid: process.pid, id, source, since, task };
  // Rewritten when that changes, so keep the current text: a ticket taken out
  // from under us has to go back as it was, url and all.
  let ticket = body();
  writeFileSync(mine, ticket);

  let gone = false;

  // The beat is what tells the others this relay is still here, so it is also
  // the only thing running when a ticket is swept from under a relay that is
  // very much alive — a machine asleep long enough that every beat looks stale.
  // Touching a file that is not there is a silent no-op, which is how a sweep
  // became permanent; writing it back makes the line heal in one beat, whether
  // or not `wait` is still in a position to notice. `ticket` is read fresh
  // because `serving` rewrites it while the relay is in line.
  const beat = setInterval(() => {
    if (gone) return;
    if (existsSync(mine)) return touch(mine);
    try {
      writeFileSync(mine, ticket);
    } catch {}
  }, beatMs);
  beat.unref();
  const stop = () => clearInterval(beat);

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
        let waiting = line(dir);
        // Our ticket only vanishes if something outside took it; put it back
        // under its original name so we keep the place we queued for.
        if (!gone && !waiting.some((t) => t.name === name)) {
          writeFileSync(mine, ticket);
          // And read the line again with it in. The line we were just handed is
          // the one our ticket was missing from, and a sweep that takes every
          // ticket at once leaves an empty line — which reads as "nobody ahead"
          // to every relay in it simultaneously, so they all leave the one loop
          // that would have put their tickets back.
          waiting = line(dir);
        }
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
 * Every relay in line, the one that should be on screen first: the priority
 * session's documents, then everyone else's, and oldest first within each.
 *
 * Oldest first *within* each and not only overall, because a marked session
 * asking twice is asking two questions in an order — the second may well be
 * about the answer to the first. Jumping the line is the mark's whole effect;
 * reversing that session's own two documents would be a second one nobody asked
 * for.
 *
 * A torn read costs a ticket its rank for one poll and not its place: it stays
 * where arrival puts it, and the next read has the whole of it. Tickets of relays
 * that are gone are swept.
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
      const { id, source, url, task } = JSON.parse(readFileSync(file, "utf8"));
      if (typeof id === "string") t.id = id;
      if (typeof source === "string") t.source = source;
      if (typeof url === "string") t.url = url;
      if (typeof task === "string") {
        t.task = task;
        if (marked(task)) t.rank = "top";
      }
    } catch {}
    live.push(t);
  }

  return live.sort((a, b) => ranks[a.rank] - ranks[b.rank] || a.at - b.at || a.pid - b.pid);
}

function sleep(ms: number): Promise<void> {
  // Unref'd: a poll should never be the reason a process is still running. A
  // relay dismissed while still in line exits now, not at the end of a tick.
  return new Promise((r) => void setTimeout(r, ms).unref());
}

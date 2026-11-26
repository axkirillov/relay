import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { alive, aliveLater, beatMs, touch } from "./live.ts";
import { queueDir } from "./paths.ts";
import { marked, markedLater } from "./priority.ts";

const pollMs = 250;

export type Rank = "top" | "normal";

const ranks: Record<Rank, number> = { top: 0, normal: 1 };

export type Turn = {
  ahead: number;
  behind(): number;
  since: number;
  serving(url: string): void;
  wait(): Promise<void>;
  leave(): void;
};

export type Waiting = {
  name: string;
  at: number;
  pid: number;
  client?: number;
  rank: Rank;
  id?: string;
  source?: string;
  session?: string;
  task?: string;
  url?: string;
};

export type Asker = {
  client?: number;
  session?: string;
};

export function enter(id: string, source: string, task: string, asker: Asker = {}): Turn {
  const dir = queueDir();
  mkdirSync(dir, { recursive: true });

  const since = Date.now();
  const name = `${since}-${process.pid}.json`;
  const mine = join(dir, name);

  const fields: Record<string, unknown> = { pid: process.pid, client: asker.client, session: asker.session, id, source, since, task };
  let ticket = body();
  writeFileSync(mine, ticket);

  let gone = false;

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
        if (!gone && !waiting.some((t) => t.name === name)) {
          writeFileSync(mine, ticket);
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

type Said = { size: number; mtimeMs: number; ticket: Partial<Waiting> };
let saidRecently = new Map<string, Said>();

function ticketNamed(name: string): Waiting | null {
  const m = /^(\d+)-(\d+)\.json$/.exec(name);
  return m ? { name, at: Number(m[1]), pid: Number(m[2]), rank: "normal" } : null;
}

function saidIn(text: string): Partial<Waiting> {
  const { id, source, url, task, client, session } = JSON.parse(text);
  const said: Partial<Waiting> = {};
  if (typeof client === "number" && Number.isInteger(client) && client > 0) said.client = client;
  if (typeof id === "string") said.id = id;
  if (typeof source === "string") said.source = source;
  if (typeof session === "string") said.session = session;
  if (typeof url === "string") said.url = url;
  if (typeof task === "string") said.task = task;
  return said;
}

function unchanged(file: string, size: number | undefined, mtimeMs: number): Said | undefined {
  const had = saidRecently.get(file);
  return had !== undefined && size !== undefined && had.size === size && had.mtimeMs === mtimeMs ? had : undefined;
}

function inOrder(live: Waiting[]): Waiting[] {
  return live.sort((a, b) => ranks[a.rank] - ranks[b.rank] || a.at - b.at || a.pid - b.pid);
}

export function line(dir = queueDir()): Waiting[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const live: Waiting[] = [];
  const seen = new Map<string, Said>();
  for (const name of names) {
    const t = ticketNamed(name);
    if (!t) continue;
    const file = join(dir, name);
    if (!alive(file, t.pid)) {
      try {
        rmSync(file);
      } catch {}
      continue;
    }
    let size: number | undefined;
    let mtimeMs = 0;
    try {
      const stats = statSync(file);
      size = stats.size;
      mtimeMs = stats.mtimeMs;
    } catch {}

    const had = unchanged(file, size, mtimeMs);
    if (had) {
      Object.assign(t, had.ticket);
      seen.set(file, had);
    } else {
      try {
        const said = saidIn(readFileSync(file, "utf8"));
        Object.assign(t, said);
        if (size !== undefined) seen.set(file, { size, mtimeMs, ticket: said });
      } catch {}
    }
    if (t.task !== undefined && marked(t.task)) t.rank = "top";
    live.push(t);
  }

  saidRecently = seen;
  return inOrder(live);
}

export async function readLine(dir = queueDir()): Promise<Waiting[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const seen = new Map<string, Said>();
  const read = await Promise.all(
    names.map(async (name): Promise<Waiting | null> => {
      const t = ticketNamed(name);
      if (!t) return null;
      const file = join(dir, name);
      if (!(await aliveLater(file, t.pid))) {
        await rm(file).catch(() => {});
        return null;
      }
      let size: number | undefined;
      let mtimeMs = 0;
      try {
        const stats = await stat(file);
        size = stats.size;
        mtimeMs = stats.mtimeMs;
      } catch {}

      const had = unchanged(file, size, mtimeMs);
      if (had) {
        Object.assign(t, had.ticket);
        seen.set(file, had);
      } else {
        try {
          const said = saidIn(await readFile(file, "utf8"));
          Object.assign(t, said);
          if (size !== undefined) seen.set(file, { size, mtimeMs, ticket: said });
        } catch {}
      }
      if (t.task !== undefined && (await markedLater(t.task))) t.rank = "top";
      return t;
    }),
  );

  saidRecently = seen;
  return inOrder(read.filter((t): t is Waiting => t !== null));
}

export function askerOf(entry: Pick<Waiting, "pid" | "client">): number {
  return entry.client ?? entry.pid;
}

export function documentName(id: string): string {
  const m = /^(\d{8})-(\d{6})-(.+)$/.exec(id);
  return m ? m[3]! : id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => void setTimeout(r, ms).unref());
}

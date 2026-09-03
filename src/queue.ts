import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { alive, beatMs, touch } from "./live.ts";
import { queueDir } from "./paths.ts";
import { marked } from "./priority.ts";

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
  rank: Rank;
  id?: string;
  source?: string;
  task?: string;
  url?: string;
};

export function enter(id: string, source: string, task: string): Turn {
  const dir = queueDir();
  mkdirSync(dir, { recursive: true });

  const since = Date.now();
  const name = `${since}-${process.pid}.json`;
  const mine = join(dir, name);

  const fields: Record<string, unknown> = { pid: process.pid, id, source, since, task };
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
  return new Promise((r) => void setTimeout(r, ms).unref());
}

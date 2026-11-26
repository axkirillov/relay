import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { relayHome } from "./paths.ts";

export type Round = {
  id: string;
  dir: string;
  sent: string;
  shown: string;
  answered: boolean;
  source: string;
  cwd?: string;
  ran?: string;
};

type Meta = { source?: string; cwd?: string; accepted?: string };

export function read(named: string): Round {
  const dir = isAbsolute(named) ? named : join(relayHome(), named);
  const id = dir.split("/").filter(Boolean).pop() ?? named;

  try {
    if (!statSync(dir).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`no such round: ${named}`);
  }

  let sent: string;
  try {
    sent = readFileSync(join(dir, "sent.md"), "utf8");
  } catch {
    throw new Error(`${id} kept no document — nothing to read`);
  }

  const meta = metaOf(dir);
  const accepted = text(join(dir, "accepted.md"));

  return {
    id,
    dir,
    sent,
    shown: accepted ?? sent,
    answered: accepted !== undefined,
    source: meta.source ?? join(dir, "sent.md"),
    cwd: meta.cwd && there(meta.cwd) ? meta.cwd : undefined,
    ran: meta.cwd,
  };
}

function metaOf(dir: string): Meta {
  try {
    return JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
  } catch {
    return {};
  }
}

function text(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function there(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

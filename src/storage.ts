import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { relayHome } from "./paths.ts";

export type Store = {
  id: string;
  dir: string;
  finish(accepted: string, patch: string): void;
  draft(text: string): void;
  abandon(shown: boolean): void;
};

export function open(source: string, sent: string): Store {
  const { id, dir } = claim(`${stamp()}-${slug(source)}`);
  writeFileSync(join(dir, "sent.md"), sent);

  const meta: Record<string, unknown> = {
    id,
    source,
    cwd: process.cwd(),
    opened: new Date().toISOString(),
  };
  const writeMeta = () => writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  writeMeta();

  return {
    id,
    dir,
    finish(accepted, patch) {
      writeFileSync(join(dir, "accepted.md"), accepted);
      writeFileSync(join(dir, "diff.patch"), patch);
      meta.accepted = new Date().toISOString();
      writeMeta();
    },
    draft(text) {
      writeFileSync(join(dir, "draft.md"), text);
      meta.drafted = new Date().toISOString();
      writeMeta();
    },
    abandon(shown) {
      meta.abandoned = new Date().toISOString();
      meta.shown = shown;
      writeMeta();
    },
  };
}

export function claim(base: string): { id: string; dir: string } {
  const home = relayHome();
  mkdirSync(home, { recursive: true });
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    const dir = join(home, id);
    try {
      mkdirSync(dir);
      return { id, dir };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function slug(path: string): string {
  const name = basename(path).replace(/\.[^.]+$/, "");
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, 40) || "doc";
}

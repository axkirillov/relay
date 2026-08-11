import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export type Store = {
  id: string;
  dir: string;
  finish(accepted: string, patch: string): void;
  abandon(): void;
};

/**
 * Every relay leaves a durable record. It matters more than it looks: the agent
 * only gets a diff back, so the document it was diffed against has to survive
 * somewhere it can be re-read.
 */
export function open(source: string, sent: string): Store {
  const id = `${stamp()}-${slug(source)}`;
  const dir = join(homedir(), ".relay", id);
  mkdirSync(dir, { recursive: true });
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
    abandon() {
      meta.abandoned = new Date().toISOString();
      writeMeta();
    },
  };
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

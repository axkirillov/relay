import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export type Store = {
  id: string;
  dir: string;
  finish(accepted: string, patch: string): void;
  /**
   * What the human has typed so far, kept because the document is about to leave
   * the screen and the page it lives in is about to be destroyed. Served back as
   * the prefill when the document returns.
   */
  draft(text: string): void;
  /**
   * A task the human wrote. There is no patch: nobody wrote the original, so
   * every character of it is theirs and the whole document is the answer.
   */
  task(text: string): void;
  abandon(): void;
  /** They accepted a blank. There was never anything here to keep. */
  discard(): void;
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
    draft(text) {
      writeFileSync(join(dir, "draft.md"), text);
      meta.drafted = new Date().toISOString();
      writeMeta();
    },
    task(text) {
      writeFileSync(join(dir, "accepted.md"), text);
      meta.accepted = new Date().toISOString();
      writeMeta();
    },
    abandon() {
      meta.abandoned = new Date().toISOString();
      writeMeta();
    },
    discard() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
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

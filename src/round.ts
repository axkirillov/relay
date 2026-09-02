import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { relayHome } from "./paths.ts";

/**
 * A round that already happened, opened to be read.
 *
 * Every relay leaves its whole exchange on disk — `storage.ts` writes it — and
 * until now nothing could open one again. The human answered a question hours ago
 * in a window that closed, and the only way back to what it said was to go digging
 * through `~/.relay` by hand.
 *
 * So this is the other half of `storage.open()`: the same directory, read. What it
 * is for is composer's ⌘R, which lists the rounds and hands one back here — see
 * `--read` in `cli.ts`, which serves what this returns to the same page the
 * document went up in the first time.
 *
 * Nothing here writes. A round is what it was on the day, and a second reading of
 * it is not a second answer.
 */
export type Round = {
  /** The round's directory name, which is what composer hands over. */
  id: string;
  dir: string;
  /**
   * What the agent sent. The baseline, so the page lights the human's own lines
   * against it exactly as it did while they were typing them.
   */
  sent: string;
  /**
   * What goes on screen: what they accepted, or what was sent when they never
   * answered. A round with no answer is still worth reading — 137 of the 2,702 here
   * never reached the screen at all — and what there is to read is the agent's own
   * words.
   */
  shown: string;
  /** Whether they answered. False means `shown` and `sent` are the same text. */
  answered: boolean;
  /** The document's path at the time. The page's title is made of its last segment. */
  source: string;
  /**
   * The directory the relay ran in, when it is still there.
   *
   * The one fact a read cannot invent. A command in a past document is run *now*, and
   * where it runs is the worktree the round came from — so a round whose tree has
   * since been torn down has nowhere to run anything, and says so rather than running
   * it somewhere else. See `runnable` in `server.ts`.
   */
  cwd?: string;
  /** Where it ran, as recorded, so the refusal can name the tree that is gone. */
  ran?: string;
};

/** What a round's `meta.json` says, of the fields a read needs. */
type Meta = { source?: string; cwd?: string; accepted?: string };

/**
 * The round composer named, ready to serve.
 *
 * An id — `20260902-103024-reader-cost-merge` — or a path to the directory itself,
 * because the id is what the ledger and the store are keyed on and the path is what a
 * human has in their hand when they try this by typing.
 *
 * Throws with the line to print. Every failure here is one of two things: a round
 * that is not there, or one whose `sent.md` has gone — and both are worth naming,
 * because the caller is a window that is about to have nothing to show.
 */
export function read(named: string): Round {
  const dir = isAbsolute(named) ? named : join(relayHome(), named);
  const id = dir.split("/").filter(Boolean).pop() ?? named;

  try {
    if (!statSync(dir).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`no such round: ${named}`);
  }

  // The one file that has to be there. It is written before the document goes up,
  // so a round without it is one that never got as far as the screen.
  let sent: string;
  try {
    sent = readFileSync(join(dir, "sent.md"), "utf8");
  } catch {
    throw new Error(`${id} kept no document — nothing to read`);
  }

  const meta = metaOf(dir);
  // `accepted.md` rather than `meta.accepted`, because the file is the thing being
  // read: a meta that says answered and a directory with no answer in it would put
  // the agent's own words on screen under the claim that they are the human's.
  const accepted = text(join(dir, "accepted.md"));

  return {
    id,
    dir,
    sent,
    shown: accepted ?? sent,
    answered: accepted !== undefined,
    // Named for the round when the meta is gone, so the strip over the document
    // still says which document this is.
    source: meta.source ?? join(dir, "sent.md"),
    cwd: meta.cwd && there(meta.cwd) ? meta.cwd : undefined,
    ran: meta.cwd,
  };
}

function metaOf(dir: string): Meta {
  try {
    return JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
  } catch {
    // A round from before relay wrote one, or one that will not parse. Everything
    // it holds is optional here, and the document is not in it.
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

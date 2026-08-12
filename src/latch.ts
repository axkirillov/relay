import { appendFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** What was in the latch when this relay started — its identity, to check later. */
type Claim = { doc: string; at: number };

/**
 * The agent's gate hook writes a latch file the moment it sees a relay being
 * launched and refuses the agent every tool call for as long as that file is
 * there. It is written in PreToolUse, before this process exists, so relay could
 * not be the one to create it — but it can be the one to remove it.
 *
 * It used to clear only when `ps` no longer found a matching relay, and that
 * lagged the human's answer by minutes: the reply had already been handed back
 * while every call the agent made to read it was still refused, and the harness
 * fires exactly one wake-up per background command. Exiting is the answer
 * arriving, so exiting is what lifts the latch.
 *
 * Only a latch that was already there when this relay started, and is still
 * byte-for-byte the same at exit, is removed. A relay run out of a worktree or
 * by hand never latched anything and so takes nothing down with it, and a round
 * that has already latched again keeps its latch.
 *
 * `ps` stays as the backstop behind this: a relay killed outright runs nothing.
 */
export function unlatchOnExit(): () => void {
  const latch = latchPath();
  const claimed = latch ? read(latch) : null;
  if (!latch || !claimed) return () => {};

  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    const now = read(latch);
    if (!now || now.doc !== claimed.doc || now.at !== claimed.at) return;
    try {
      rmSync(latch);
    } catch {
      return;
    }
    note(claimed.doc);
  };

  process.once("exit", release);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      release();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }

  return release;
}

/** The gate keys its latch by session, and hands relay the same id to find it. */
function latchPath(): string | null {
  const sid = process.env.CLAUDE_CODE_SESSION_ID;
  return sid ? join(stateDir(), `open-${sid}`) : null;
}

function stateDir(): string {
  return process.env.RELAY_GATE_STATE || join(homedir(), ".local", "state", "relay");
}

function read(latch: string): Claim | null {
  try {
    return { doc: readFileSync(latch, "utf8"), at: statSync(latch).mtimeMs };
  } catch {
    return null;
  }
}

/** Into the gate's own log, so one file tells the whole story of a round. */
function note(doc: string) {
  const line =
    JSON.stringify({
      ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      hook: "relay",
      event: "unlatched",
      session: process.env.CLAUDE_CODE_SESSION_ID,
      doc: doc.trim(),
    }) + "\n";
  try {
    appendFileSync(join(stateDir(), "relay-gate.log"), line);
  } catch {}
}

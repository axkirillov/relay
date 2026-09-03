import { appendFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Claim = { doc: string; at: number };

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

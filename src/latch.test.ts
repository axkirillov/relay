import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "relay-latch-"));
process.env.RELAY_GATE_STATE = dir;

const { unlatchOnExit } = await import("./latch.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/** What the gate hook writes when it sees a relay being launched. */
function latch(session: string, doc: string, ageMs = 0): string {
  const file = join(dir, `open-${session}`);
  writeFileSync(file, doc + "\n");
  if (ageMs) {
    const then = new Date(Date.now() - ageMs);
    utimesSync(file, then, then);
  }
  return file;
}

function session(id: string | undefined) {
  if (id) process.env.CLAUDE_CODE_SESSION_ID = id;
  else delete process.env.CLAUDE_CODE_SESSION_ID;
}

function log(): Record<string, unknown>[] {
  try {
    return readFileSync(join(dir, "relay-gate.log"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// --- the latch this relay was launched under ---------------------------------
{
  const mine = latch("s1", "/tmp/a.md");
  session("s1");
  const release = unlatchOnExit();
  check("open window: latch still held", existsSync(mine), true);

  release();
  check("answered: latch gone", existsSync(mine), false);

  const last = log().at(-1);
  check("answered: the clear is logged", last?.event, "unlatched");
  check("answered: logged against this session", last?.session, "s1");
  check("answered: logged with the document", last?.doc, "/tmp/a.md");
}

// --- a latch that is no longer the one we started under ----------------------
{
  // The round we latched for ended; the next one latched again before this
  // release ran. Taking that one down would let the agent work ahead of a live
  // window — the whole failure this gate exists to prevent.
  latch("s2", "/tmp/b.md");
  session("s2");
  const release = unlatchOnExit();

  const next = latch("s2", "/tmp/c.md");
  release();
  check("relatched, other document: left alone", existsSync(next), true);
}

{
  latch("s3", "/tmp/d.md");
  session("s3");
  const release = unlatchOnExit();

  const again = latch("s3", "/tmp/d.md", -5000); // same document, latched later
  release();
  check("relatched, same document: left alone", existsSync(again), true);
  rmSync(again);
}

// --- other sessions ----------------------------------------------------------
{
  const theirs = latch("s4-other", "/tmp/e.md");
  latch("s4", "/tmp/f.md");
  session("s4");
  unlatchOnExit()();
  check("another session's latch: untouched", existsSync(theirs), true);
  rmSync(theirs);
}

// --- nothing to release ------------------------------------------------------
{
  // Run out of a worktree or by hand: no session, so nothing ever latched.
  const untouched = latch("s5", "/tmp/g.md");
  session(undefined);
  unlatchOnExit()();
  check("no session id: nothing removed", existsSync(untouched), true);
  rmSync(untouched);
}

{
  session("s6");
  const before = log().length;
  unlatchOnExit()(); // no latch file at all
  check("no latch: nothing created", existsSync(join(dir, "open-s6")), false);
  check("no latch: nothing logged", log().length, before);
}

// --- releasing twice ---------------------------------------------------------
{
  latch("s7", "/tmp/h.md");
  session("s7");
  const release = unlatchOnExit();
  release();

  const next = latch("s7", "/tmp/i.md");
  release();
  check("released twice: the next round's latch survives", existsSync(next), true);
  rmSync(next);
}

rmSync(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

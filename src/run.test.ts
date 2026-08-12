import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A plain shell, so nobody's profile can put a banner in the assertions.
process.env.SHELL = "/bin/sh";

const { maxOutputBytes, start } = await import("./run.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function has(name: string, haystack: string, needle: string) {
  check(name, haystack.includes(needle), true);
}

/** Everything a command wrote, once it is over. */
async function ran(command: string, cwd = process.cwd()): Promise<string> {
  let out = "";
  const job = start(command, cwd, (t) => {
    out += t;
  });
  await job.done;
  return out;
}

// --- what comes back ---------------------------------------------------------
check("stdout is captured", (await ran("echo hello")).trim(), "hello");
check("stderr is captured too", (await ran("echo boom >&2")).trim(), "boom");

{
  const out = await ran("echo out; echo err >&2");
  has("both streams arrive: stdout", out, "out");
  has("both streams arrive: stderr", out, "err");
}

// --- how it ended ------------------------------------------------------------
check("a clean run says nothing extra", await ran("true"), "");
has("a failure carries its status", await ran("exit 3"), "[exit 3]");
check("the status is only there on failure", (await ran("echo fine")).includes("[exit"), false);

// --- where it ran ------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "relay-run-"));
  check("it runs in the relay's cwd", (await ran("pwd", dir)).trim(), realpathSync(dir));
  rmSync(dir, { recursive: true, force: true });
}

// --- stopping it -------------------------------------------------------------
{
  let out = "";
  const job = start("sleep 30", process.cwd(), (t) => {
    out += t;
  });
  job.kill();
  await job.done;
  has("a stopped command says so", out, "[stopped]");
}

{
  // The command, not just the shell holding it: a signal to the group is what
  // makes this true, and a plain kill of `sh -c` would leave the sleep behind.
  const marker = mkdtempSync(join(tmpdir(), "relay-group-"));
  const job = start(`(sleep 30; touch ${marker}/survived) &  wait`, process.cwd(), () => {});
  await new Promise((r) => setTimeout(r, 200));
  job.kill();
  await job.done;
  const after = await ran(`ls ${marker}`);
  check("stopping takes the whole group with it", after.includes("survived"), false);
  rmSync(marker, { recursive: true, force: true });
}

// --- output that would never end ---------------------------------------------
{
  const out = await ran("yes relay");
  has("runaway output is capped", out, "output passed");
  check("and the document is not flooded", out.length < maxOutputBytes * 2, true);
}

// --- a command that asks a question -----------------------------------------
// stdin is closed rather than left hanging on a prompt nobody can see.
check("reading stdin gets end-of-file", (await ran("cat")).trim(), "");

process.exit(fails ? 1 : 0);

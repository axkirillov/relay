import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spillPath } from "./spill.ts";

// A plain shell, so nobody's profile can put a banner in the assertions.
process.env.SHELL = "/bin/sh";

const { defaultScreenLines, maxDocBytes, maxOutputBytes, start, tailLines } = await import("./run.ts");

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

const logs = mkdtempSync(join(tmpdir(), "relay-logs-"));
let runs = 0;
const nextLog = () => join(logs, `run-${++runs}.log`);

/** Everything a command wrote into the document, once it is over. */
async function ran(command: string, cwd = process.cwd()): Promise<string> {
  return (await both(command, cwd)).doc;
}

/**
 * The document's share of a run, and the file's if it needed one. `screen` is
 * the window the output is going into, in lines — left out where the run is
 * about something other than how tall the window is.
 */
async function both(command: string, cwd = process.cwd(), screen?: number) {
  const log = nextLog();
  let doc = "";
  const job = start(
    command,
    cwd,
    (t) => {
      doc += t;
    },
    log,
    screen,
  );
  await job.done;
  return { doc, log, spilled: existsSync(log), file: existsSync(log) ? readFileSync(log, "utf8") : "" };
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
  const job = start(
    "sleep 30",
    process.cwd(),
    (t) => {
      out += t;
    },
    nextLog(),
  );
  job.kill();
  await job.done;
  has("a stopped command says so", out, "[stopped]");
}

{
  // The command, not just the shell holding it: a signal to the group is what
  // makes this true, and a plain kill of `sh -c` would leave the sleep behind.
  const marker = mkdtempSync(join(tmpdir(), "relay-group-"));
  const job = start(`(sleep 30; touch ${marker}/survived) &  wait`, process.cwd(), () => {}, nextLog());
  await new Promise((r) => setTimeout(r, 200));
  job.kill();
  await job.done;
  const after = await ran(`ls ${marker}`);
  check("stopping takes the whole group with it", after.includes("survived"), false);
  rmSync(marker, { recursive: true, force: true });
}

// --- output too long for the document ----------------------------------------
{
  const { doc, spilled } = await both("seq 1 20");
  check("a short run leaves no file behind", spilled, false);
  has("and all of it is in the document", doc, "\n20\n");
}

{
  const { doc, log, file } = await both("seq 1 5000");
  check("a long run writes a file", file.split("\n").length - 1, 5000);
  check("the file has every line, first to last", [file.startsWith("1\n"), file.endsWith("5000\n")], [true, true]);

  has("the document keeps the head", doc, `\n${defaultScreenLines}\n`);
  check("and stops there", doc.includes(`\n${defaultScreenLines + 1}\n`), false);
  has("the document says where the rest went", doc, log);
  check("and the fold can read that file back out of it", spillPath(doc), log);
  has(
    "it says how much it is not showing",
    doc,
    `${(5000 - defaultScreenLines - tailLines).toLocaleString("en-US")} more lines`,
  );
  has("and it keeps the tail", doc, "\n5000\n");
  check("the document itself stays small", doc.length < maxDocBytes, true);
}

// --- the window is what "too long" means -------------------------------------
// Not a flat hundred lines: the length past which output stops fitting on the
// screen it landed on is the height of that screen.
{
  const { doc, spilled } = await both("seq 1 200", process.cwd(), 40);
  check("output taller than the window goes to a file", spilled, true);
  has("the document keeps a windowful of it", doc, "\n40\n");
  check("and stops there", doc.includes("\n41\n"), false);
  has("the rest is counted from the window, not from a hundred", doc, "140 more lines");
  has("and the tail is still the last twenty", doc, "\n200\n");
}

{
  // The same output either side of the line, and nothing but the window's height
  // between the two answers.
  check("one line over the window is already too long", (await both("seq 1 41", process.cwd(), 40)).spilled, true);
  const { doc, spilled } = await both("seq 1 60", process.cwd(), 80);
  check("and sixty lines in an eighty-line window stay put", spilled, false);
  has("all of it, to the last line", doc, "\n60\n");
}

{
  // A hundred-line output on a hundred-line window is the boundary itself: the
  // window holds it, so nothing goes anywhere.
  const { spilled } = await both("seq 1 100", process.cwd(), 100);
  check("an output exactly a windowful long is not too long", spilled, false);
}

{
  // A window so short that head and tail would hold the whole output anyway —
  // the file would be a second copy of what the document already has.
  const { spilled } = await both("seq 1 22", process.cwd(), 2);
  check("a window too short to gain anything spills nothing", spilled, false);
}

has("a spilled run still carries its exit status", (await both("seq 1 5000; exit 3")).doc, "[exit 3]");

{
  // Lines are not the only way to be too long: one line of minified javascript
  // would never reach a hundred of anything.
  const { doc, spilled } = await both("head -c 200000 /dev/zero | tr '\\0' x");
  check("one enormous line spills too", spilled, true);
  has("and what is shown of it is cut", doc, "line cut here");
  check("so the document stays small either way", doc.length < maxDocBytes * 2, true);
}

// --- output that would never end ---------------------------------------------
{
  const { doc, file, spilled } = await both("yes relay");
  has("runaway output is capped", doc, "output passed");
  check("and the document is not flooded", doc.length < maxDocBytes * 2, true);
  check("what it did write is still on disk", spilled, true);
  check("and the disk is not flooded either", file.length < maxOutputBytes * 2, true);
}

// --- a command that asks a question -----------------------------------------
// stdin is closed rather than left hanging on a prompt nobody can see.
check("reading stdin gets end-of-file", (await ran("cat")).trim(), "");

rmSync(logs, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

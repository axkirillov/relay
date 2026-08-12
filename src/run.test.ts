import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A plain shell, so nobody's profile can put a banner in the assertions.
process.env.SHELL = "/bin/sh";

const { headLines, maxDocBytes, maxOutputBytes, start, tailLines } = await import("./run.ts");

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

/** The document's share of a run, and the file's if it needed one. */
async function both(command: string, cwd = process.cwd()) {
  const log = nextLog();
  let doc = "";
  const job = start(
    command,
    cwd,
    (t) => {
      doc += t;
    },
    log,
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

  has("the document keeps the head", doc, `\n${headLines}\n`);
  check("and stops there", doc.includes(`\n${headLines + 1}\n`), false);
  has("the document says where the rest went", doc, log);
  has("it says how much it is not showing", doc, `${(5000 - headLines - tailLines).toLocaleString("en-US")} more lines`);
  has("and it keeps the tail", doc, "\n5000\n");
  check("the document itself stays small", doc.length < maxDocBytes, true);
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

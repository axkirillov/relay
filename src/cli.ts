import { spawn } from "node:child_process";
import { accessSync, constants, openSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createTwoFilesPatch, structuredPatch } from "diff";

import { commentReport } from "./diff.js";
import { unlatchOnExit } from "./latch.js";
import { taskDoc } from "./page.js";
import { taskHook } from "./paths.js";
import * as queue from "./queue.js";
import { serve } from "./server.js";
import * as storage from "./storage.js";
import { attend } from "./window.js";

const usage = `relay <file.md>
relay new

Show a markdown document to the human and wait — for as long as it takes — for
their reply. They can edit anywhere in it; their edits are highlighted live
against what you sent.

\`relay new\` is the other direction: an empty document for the human to write a
task in, which nobody sent and nothing is waiting on. It goes to the front of the
line, and what they write comes back on stdout as text rather than as a diff —
there is no original to diff against, so the whole document is theirs. An empty
one is thrown away. If \`~/.relay/task\` (or \`$RELAY_TASK\`) is there, it is run
with the round's directory, which is how the task reaches anything at all when
there is no agent waiting and no shell to print to.

On accept, the unified diff of their edits is printed to stdout and relay exits
0. If they close the window without replying, relay exits 1 and prints nothing.

A \`\`\`diff block is shown as a review the human can write in. They edit the patch
where it stands, and any line they write that does not open with a diff marker is
a comment — those come back under the diff, each one located as file:line.

There is one relay window. Documents go through it one at a time, in the order
their relays started, so this one appears once those ahead of it are done —
and closing that window dismisses everything still waiting, this included.

Waiting for a human outlasts most command timeouts, and a queued relay waits
longer still. If the harness running this puts a clock on a command, start relay
in the background and read its output when it exits — a timeout that fires while
the window is open costs the human's reply.

  RELAY_NO_OPEN=1   serve the document but do not open a window
  RELAY_DEBUG=1     let the window's own output through to stderr
`;

// Before anything that can exit. A relay that cannot even read its document has
// still latched the agent's gate, and stays refused until this has run.
unlatchOnExit();

// The window's own process is Electron, so a relay it starts has to be told to be
// node. That was for this process only: everything spawned from here — the hook,
// another relay, a window — is not Electron and must not inherit it.
delete process.env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2).filter((a) => a !== "--");
const help = args.includes("-h") || args.includes("--help");
// A task the human writes themselves. `--idle` is the window's own blank, which
// differs in one way: it waits at the back of the line rather than the front,
// because nobody asked for it.
const task = args[0] === "new";
const idle = task && args[1] === "--idle";
const shaped = help || (task ? args.length === (idle ? 2 : 1) : args.length === 1);
if (!shaped || help) {
  process.stderr.write(usage);
  process.exit(help ? 0 : 2);
}

// In the one place a document has no path of its own, it has a name instead.
const path = task ? taskDoc : resolve(args[0]!);
let sent = "";
if (!task) {
  try {
    sent = await readFile(path, "utf8");
  } catch (err) {
    process.stderr.write(`relay: cannot read ${path}: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

const prefill = process.env.RELAY_PREFILL ? await readFile(process.env.RELAY_PREFILL, "utf8") : sent;

const store = storage.open(path, sent);
// Joined before the server comes up, so the line is in the order the relays were
// run. With no window there is nothing to line up for.
const turn = process.env.RELAY_NO_OPEN ? null : queue.enter(store.id, path, rank());

// Whether there is anything of theirs in this document, as last saved. A blank
// they never touched — or emptied again — is worth nothing when the window is
// closed on it; one with words still in it is worth saying where they went.
let drafted = false;

// The round's own directory holds what a long command wrote, beside the document
// it was run from.
const relay = await serve(path, sent, prefill, store.dir, {
  onDraft(text) {
    drafted = !!text.trim();
    store.draft(text);
    // Their words are in it now, so it is a task they meant to write rather than
    // the blank they were offered — and it keeps the screen against anything that
    // arrives next. Deleted again, it goes back where it came in: an empty task is
    // one relay throws away on accept, so it has nothing to hold the screen with.
    if (task) text.trim() ? turn?.promote() : turn?.demote();
  },
  onNew: newTask,
  behind: () => turn?.behind() ?? 0,
});
// The window reads this off the ticket. Until it is there the window waits,
// rather than skipping ahead to someone who is already serving.
turn?.serving(relay.url);

process.stderr.write(`relay: waiting for the human — ${relay.url}\n`);
// The one line every caller sees, and the one a timed-out caller is handed.
process.stderr.write(
  "relay: this blocks until they answer — if a command timeout can fire first, run relay in the background\n",
);

if (turn?.ahead) process.stderr.write(`relay: queued behind ${turn.ahead} — waiting for the window\n`);

// From here on the window is somebody's job, and it is this relay's for as long
// as it is at the head of the line. Waiting its turn and watching for the human
// closing the window are the same watch: a close dismisses everyone in line.
// The blank never starts a window. It is there to fill a screen that already
// exists, and a window that died would otherwise come back holding an empty
// document nobody asked for.
const screen = turn ? attend(turn, relay.url, !!process.env.RELAY_DEBUG, !idle) : null;

const accepted = relay.accepted.then((edited) => ({ edited }));
const dismissed: Promise<null> = screen ? screen.closed.then(() => null) : new Promise(() => {});

let outcome = await Promise.race([accepted, dismissed]);

// The window going and a reply landing can fall within milliseconds of each
// other; a reply already in flight wins.
if (outcome === null) outcome = await Promise.race([accepted, wait(300).then(() => null)]);

// Leaving the line is what moves the window on to the next document, so it goes
// before the diff work rather than after it.
turn?.leave();
screen?.stop();
relay.close();

if (outcome === null) {
  // A blank with nothing in it leaves nothing behind, whether they never typed or
  // took it all back out: there was no document here, and a directory saying so is
  // just litter. The same judgement accepting an empty one makes.
  if (task && !drafted) store.discard();
  else store.abandon();
  process.stderr.write(
    screen?.shown()
      ? "relay: the human closed the window without replying\n"
      : "relay: the human closed the window before this document reached the screen\n",
  );
  if (task && drafted) process.stderr.write(`relay: what they had written is at ${join(store.dir, "draft.md")}\n`);
  process.exitCode = 1;
} else if (task) {
  const text = outcome.edited;
  // Nothing was written, so there is no task. Thrown away in full: no hook is
  // run, nothing is spawned, and the round leaves no trace — accepting a blank
  // by accident should cost nothing at all.
  if (!text.trim()) {
    store.discard();
    process.stderr.write("relay: the blank was accepted empty — nothing to do\n");
    process.exitCode = 1;
  } else {
    store.task(text);
    // The text itself, not a patch. Nobody wrote the original, so every
    // character is the human's and a diff would be the whole document with a `+`
    // in front of every line.
    process.stdout.write(text.endsWith("\n") ? text : text + "\n");
    await handOff(text);
  }
} else {
  const rel = relative(process.cwd(), path);
  const name = !rel || rel.startsWith("..") ? path : rel;
  const patch = clean(createTwoFilesPatch(name, name, sent, outcome.edited));
  store.finish(outcome.edited, patch);

  const changed = structuredPatch(name, name, sent, outcome.edited).hunks.length > 0;
  process.stdout.write(changed ? patch : "no changes — the human accepted the document as written\n");
  // Their comments on a reviewed diff, under it and located. They arrive as
  // added lines like everything else, so the diff alone cannot say which of the
  // human's lines are remarks about the patch and which are the patch — this is
  // the other half of the answer to that. Only when something changed: a comment
  // is itself a change, so an untouched document has none.
  if (changed) process.stdout.write(commentReport(outcome.edited));
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rank(): queue.Rank {
  if (!task) return "normal";
  // A task the human asked for goes in front of whatever they were reading —
  // they asked for it just now. The window's own blank goes behind everything,
  // because it is only holding a screen nobody else wants.
  return idle ? "idle" : "top";
}

/**
 * Another blank, at the front of the line, because the human asked for one while
 * reading something else. Detached: this relay is not its parent in any sense
 * that matters, and it must outlive the document that was on screen when the key
 * was pressed.
 *
 * From their home directory for the same reason the window's blank is — a task
 * belongs to nobody yet, so it should not inherit the cwd of whichever worktree
 * happened to be showing.
 */
function newTask(): void {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "new"], {
    cwd: homedir(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/**
 * Hand the task to whatever the human has put at `~/.relay/task`, with the
 * round's directory — `accepted.md` in it is what they wrote.
 *
 * relay knows nothing about what happens next, and that is the point: which repo,
 * which worktree, which agent are the human's own conventions, and they live in
 * their script rather than in here.
 *
 * A hook that is missing or will not start is said out loud, in a document,
 * through the window they are already looking at. A task that quietly never
 * happened is the one outcome this whole feature cannot afford.
 */
async function handOff(text: string): Promise<void> {
  const hook = taskHook();
  try {
    accessSync(hook, constants.X_OK);
  } catch {
    return notice(`\`${hook}\` is not there, or is not executable, so nothing has been told about it.`, text);
  }

  const log = openSync(join(store.dir, "task.log"), "a");
  const child = spawn(hook, [store.dir], {
    cwd: homedir(),
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, RELAY_TASK_DIR: store.dir },
  });
  child.unref();

  // Whether it started at all is knowable, and worth waiting the one tick it
  // takes to know. What it does afterwards is its own business and goes to
  // task.log.
  await new Promise<void>((done) => {
    child.once("spawn", () => done());
    child.once("error", (err) => void notice(`\`${hook}\` would not start: ${err.message}`, text).then(done));
  });
}

/**
 * Tell the human, the only way relay knows how to tell anyone anything: put a
 * document in the line. It arrives in the window they are already looking at.
 */
async function notice(what: string, text: string): Promise<void> {
  const kept = join(store.dir, "accepted.md");
  const opening = text.trim().split("\n").slice(0, 3).join("\n");
  const doc = [
    "# this task did not start",
    "",
    `You wrote a task and ${what}`,
    "",
    "It is kept, in full, at:",
    "",
    `    ${kept}`,
    "",
    "The hook is run with the round's directory as its only argument, and",
    "`$RELAY_TASK` points somewhere else if you would rather it lived elsewhere.",
    "",
    "## what you wrote",
    "",
    opening,
    "",
  ].join("\n");

  const file = join(store.dir, "notice.md");
  try {
    writeFileSync(file, doc);
  } catch {
    return void process.stderr.write(`relay: no task hook, and could not write a notice — task at ${kept}\n`);
  }
  process.stderr.write(`relay: no task hook — telling the human in the window; task at ${kept}\n`);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), file], {
    cwd: homedir(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await new Promise<void>((done) => {
    child.once("spawn", () => done());
    child.once("error", () => done());
  });
}

/** Drop the `Index:`/`====` preamble jsdiff prepends; git-style is enough. */
function clean(patch: string): string {
  return patch.replace(/^(Index:.*\n)?={10,}\n/, "");
}

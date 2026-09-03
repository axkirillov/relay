import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { createTwoFilesPatch, structuredPatch } from "diff";

import { commentReport } from "./diff.js";
import { unlatchOnExit } from "./latch.js";
import * as about from "./about.js";
import * as priority from "./priority.js";
import * as queue from "./queue.js";
import { read as readRound, type Round } from "./round.js";
import { scratchDir } from "./run.js";
import { serve } from "./server.js";
import * as storage from "./storage.js";
import * as tasks from "./task.js";
import { attend } from "./window.js";

const usage = `relay <file.md>
relay --about
relay --priority [off]
relay --read <round>

Show a markdown document to the human and wait — for as long as it takes — for
their reply. They can edit anywhere in it; their edits are highlighted live
against what you sent.

On accept, the unified diff of their edits is printed to stdout and relay exits
0. If they close the window without replying, relay exits 1 and prints nothing.

A \`\`\`diff block is shown as a review the human can write in. They edit the patch
where it stands, and any line they write that does not open with a diff marker is
a comment — those come back under the diff, each one located as file:line.

What this session is about — the answer to that one question, in your own prose, and
nothing else in the file — is drawn by composer as a card the human raises with ⌘P.
Not by relay, and not over the document unasked. \`--about\` prints the file to write
it in, one per worktree; \`composer --about\` prints the same one and is the flag to
reach for.

Update it before every relay. The card says when you last wrote it, and once a round
has gone by untouched it says that too, to the human reading it.

There is one relay window. Documents go through it one at a time, in the order
their relays started, so this one appears once those ahead of it are done —
and closing that window dismisses everything still waiting, this included.

Unless the human has marked a session as the one that matters. \`relay --priority\`,
run in a worktree, puts that worktree's documents in front of every other
session's however long those have been waiting; \`relay --priority off\` takes it
back. It is theirs to set, not an agent's — nothing here changes it.

\`--read\` is composer's rather than an agent's. It serves a round that already
happened — the name of a directory in ~/.relay, or the path to one — as it looked
the day it arrived, and prints the URL on stdout. Nothing is asked and nothing is
answered: it joins no line, files no round, and waits until it is killed. The human
reaches their past rounds with ⌘R, which is what runs this.

Waiting for a human outlasts most command timeouts, and a queued relay waits
longer still. If the harness running this puts a clock on a command, start relay
in the background and read its output when it exits — a timeout that fires while
the window is open costs the human's reply.

  RELAY_NO_OPEN=1   serve the document but do not open a window
  RELAY_DEBUG=1     let the window's own output through to stderr
`;

delete process.env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2).filter((a) => a !== "--");

if (args[0] !== "--read") unlatchOnExit();

if (args.length === 1 && args[0] === "--about") {
  process.stdout.write(about.open(tasks.taskOf(process.cwd())) + "\n");
  process.exit(0);
}

if (args.length <= 2 && args[0] === "--priority") {
  const state = args[1] ?? "on";
  if (state !== "on" && state !== "off") {
    process.stderr.write(`relay: --priority takes "off", or nothing at all\n`);
    process.exit(2);
  }
  const task = tasks.taskOf(process.cwd());
  const was = priority.marked(task);
  try {
    priority.mark(task, state === "on");
  } catch (err) {
    process.stderr.write(`relay: cannot mark ${tasks.name(task)}: ${(err as Error).message}\n`);
    process.exit(2);
  }
  const others = priority.all().filter((t) => t !== task).map(tasks.name);
  process.stdout.write(
    state === "on"
      ? `${tasks.name(task)} is priority — its documents go to the front of the line\n`
      : was
        ? `${tasks.name(task)} is no longer priority\n`
        : `${tasks.name(task)} was not priority\n`,
  );
  process.stdout.write(
    others.length
      ? `${state === "on" ? "also" : "still"} priority: ${others.join(", ")}\n`
      : state === "on"
        ? ""
        : "nothing is priority now — the line is by arrival again\n",
  );
  process.exit(0);
}

if (args.length === 2 && args[0] === "--read") {
  let round: Round;
  try {
    round = readRound(args[1]!);
  } catch (err) {
    process.stderr.write(`relay: ${(err as Error).message}\n`);
    process.exit(2);
  }

  if (round.cwd) process.chdir(round.cwd);

  const past = await serve(round.source, round.sent, round.shown, scratchDir, {
    framed: true,
    readOnly: true,
    runnable: !!round.cwd,
    ran: round.ran,
  });

  process.stdout.write(past.url + "\n");
  await new Promise(() => {});
}

if (args[0] === "--read") {
  process.stderr.write("relay: --read takes one round — the name of a directory in ~/.relay, or the path to one\n");
  process.exit(2);
}

const help = args.includes("-h") || args.includes("--help");
if (help || args.length !== 1) {
  process.stderr.write(usage);
  process.exit(help ? 0 : 2);
}

const path = resolve(args[0]!);
let sent: string;
try {
  sent = await readFile(path, "utf8");
} catch (err) {
  process.stderr.write(`relay: cannot read ${path}: ${(err as Error).message}\n`);
  process.exit(2);
}

const task = tasks.taskOf(process.cwd());
tasks.fill();
const past = tasks.rounds(task);
const wrote = about.read(task);

const prefill = process.env.RELAY_PREFILL ? await readFile(process.env.RELAY_PREFILL, "utf8") : sent;

const store = storage.open(path, sent);
tasks.note(task, store.id);
const turn = process.env.RELAY_NO_OPEN ? null : queue.enter(store.id, path, task);

const relay = await serve(path, sent, prefill, () => store.dir, {
  onDraft: store.draft,
  behind: () => turn?.behind() ?? 0,
  framed: !!turn && !!wrote,
});
turn?.serving(relay.url);

process.stderr.write(`relay: waiting for the human — ${relay.url}\n`);
process.stderr.write(
  "relay: this blocks until they answer — if a command timeout can fire first, run relay in the background\n",
);

const behind = wrote ? about.stale(wrote, past) : 0;
const missed = past.length + 1 - behind;
const where = about.tilde(about.file(task));
process.stderr.write(
  !wrote
    ? `relay: this task has no --about — write what this session is about at ${where}, and ⌘P puts it on the human's screen over every document\n`
    : behind
      ? `relay: the --about for this task has not been touched in ${missed} round${missed === 1 ? "" : "s"} — the card says so the moment they press ⌘P; update ${where}\n`
      : `relay: the --about for this task is ${where} — keep it current\n`,
);

if (priority.marked(task))
  process.stderr.write("relay: this session is priority — this document goes to the front of the line\n");
if (turn?.ahead) process.stderr.write(`relay: queued behind ${turn.ahead} — waiting for the window\n`);

const screen = turn ? attend(turn, relay.url, !!process.env.RELAY_DEBUG) : null;

const accepted = relay.accepted.then((edited) => ({ edited }));
const dismissed: Promise<null> = screen ? screen.closed.then(() => null) : new Promise(() => {});

let outcome = await Promise.race([accepted, dismissed]);

if (outcome === null) outcome = await Promise.race([accepted, wait(300).then(() => null)]);

turn?.leave();
screen?.stop();
relay.close();

if (outcome === null) {
  store.abandon(!!screen?.shown());
  process.stderr.write(
    screen?.shown()
      ? "relay: the human closed the window without replying\n"
      : "relay: the human closed the window before this document reached the screen\n",
  );
  process.exitCode = 1;
} else {
  const rel = relative(process.cwd(), path);
  const name = !rel || rel.startsWith("..") ? path : rel;
  const patch = clean(createTwoFilesPatch(name, name, sent, outcome.edited));
  store.finish(outcome.edited, patch);

  const changed = structuredPatch(name, name, sent, outcome.edited).hunks.length > 0;
  process.stdout.write(changed ? patch : "no changes — the human accepted the document as written\n");
  if (changed) process.stdout.write(commentReport(outcome.edited));
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clean(patch: string): string {
  return patch.replace(/^(Index:.*\n)?={10,}\n/, "");
}

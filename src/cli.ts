import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { createTwoFilesPatch, structuredPatch } from "diff";

import { commentReport } from "./diff.js";
import { unlatchOnExit } from "./latch.js";
import * as plan from "./plan.js";
import * as queue from "./queue.js";
import { serve } from "./server.js";
import * as storage from "./storage.js";
import * as tasks from "./task.js";
import { attend } from "./window.js";

const usage = `relay <file.md>
relay --plan

Show a markdown document to the human and wait — for as long as it takes — for
their reply. They can edit anywhere in it; their edits are highlighted live
against what you sent.

On accept, the unified diff of their edits is printed to stdout and relay exits
0. If they close the window without replying, relay exits 1 and prints nothing.

A \`\`\`diff block is shown as a review the human can write in. They edit the patch
where it stands, and any line they write that does not open with a diff marker is
a comment — those come back under the diff, each one located as file:line.

The task's plan — a short overview of the work and a to-do list, ticked off as it
goes — is drawn by composer as a band over the document, not by relay. \`--plan\`
prints the file to write it in, one per worktree; \`composer --plan\` prints the same
one and is the flag to reach for.

Update it before every relay. The band says when you last wrote it, and once a round
has gone by untouched it says that too, to the human reading it.

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

// A relay started from inside an Electron process — one that spawned a shell, or
// a program that spawned this — inherits a variable telling Electron to be node.
// That was meant for that process and not for anything downstream of it:
// everything spawned from here, the window among them, must be what it says.
delete process.env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2).filter((a) => a !== "--");

// Where this task's plan goes. Kept working after the band moved to composer, so an
// agent told the old flag still lands on the file composer draws.
if (args.length === 1 && args[0] === "--plan") {
  process.stdout.write(plan.open(tasks.taskOf(process.cwd())) + "\n");
  process.exit(0);
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

// The document goes up as the agent wrote it. What the task is and how far along it
// has got is composer's band over the document column now, so nothing is stapled to
// the text the human is editing: `sent` is what is diffed against, what is kept, and
// what the editor opens with.
const task = tasks.taskOf(process.cwd());
// Once ever, and before the first read of the ledger: the rounds that were
// relayed before relay kept one, filed under the tasks they came from. Without it
// every task in flight would be counting from its next round.
tasks.fill();
const past = tasks.rounds(task);
const wrote = plan.read(task);

const prefill = process.env.RELAY_PREFILL ? await readFile(process.env.RELAY_PREFILL, "utf8") : sent;

const store = storage.open(path, sent);
// After the count was taken, so that this round is the one it counted up to:
// the document on screen is the task's Nth, and the ledger says N once this
// round is in it.
tasks.note(task, store.id);
// Joined before the server comes up, so the line is in the order the relays were
// run. With no window there is nothing to line up for.
const turn = process.env.RELAY_NO_OPEN ? null : queue.enter(store.id, path);

// The round's own directory holds what a long command wrote, beside the document
// it was run from.
const relay = await serve(path, sent, prefill, store.dir, {
  onDraft: store.draft,
  behind: () => turn?.behind() ?? 0,
  // In the line, and the task has a plan: composer will draw its band over this
  // document, so the page leaves its own header off — one strip, not two. Both
  // halves matter. Nothing in the line means nobody is going to frame this and the
  // URL is being opened by hand; and composer's rule is *no plan, no band*, which
  // it decides off this same file, so a task without one keeps the header that
  // holds the traffic lights clear of the first line.
  framed: !!turn && !!wrote,
});
// The window reads this off the ticket. Until it is there the window waits,
// rather than skipping ahead to someone who is already serving.
turn?.serving(relay.url);

process.stderr.write(`relay: waiting for the human — ${relay.url}\n`);
// The one line every caller sees, and the one a timed-out caller is handed.
process.stderr.write(
  "relay: this blocks until they answer — if a command timeout can fire first, run relay in the background\n",
);

// The one place the agent is already reading when it thinks about this task, and now
// the only one: the band that says the same thing is on the human's screen, not in
// what relay hands back.
const behind = wrote ? plan.stale(wrote, past) : 0;
// How many rounds went up after it was last written, this one not counted: it is
// going up now, and it is the one being complained about.
const missed = past.length + 1 - behind;
const where = plan.tilde(plan.file(task));
process.stderr.write(
  !wrote
    ? `relay: this task has no plan — write one at ${where} and the window carries it over every document\n`
    : behind
      ? `relay: the plan over this document has not been touched in ${missed} round${missed === 1 ? "" : "s"} — the band is telling the human so; update ${where}\n`
      : `relay: the plan over this document is ${where} — keep it current\n`,
);

if (turn?.ahead) process.stderr.write(`relay: queued behind ${turn.ahead} — waiting for the window\n`);

// From here on the window is somebody's job, and it is this relay's for as long
// as it is at the head of the line. Waiting its turn and watching for the human
// closing the window are the same watch: a close dismisses everyone in line.
const screen = turn ? attend(turn, relay.url, !!process.env.RELAY_DEBUG) : null;

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

/** Drop the `Index:`/`====` preamble jsdiff prepends; git-style is enough. */
function clean(patch: string): string {
  return patch.replace(/^(Index:.*\n)?={10,}\n/, "");
}

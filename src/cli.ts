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

Under the document relay adds the task's plan: a short overview of the work and a
to-do list, ticked off as it goes. \`relay --plan\` prints the file to write it in —
one per worktree, yours to keep current. The human is assumed to know nothing about
the task but what relay has shown them, and hours pass between windows: this is
what says what the question is about and how far along the work is. It is part of
the baseline, so it costs you nothing in the diff unless they write in it — and if
they do write in it, fold what they said back into the file.

Update it before every relay. The document says when you last wrote it, and once a
round has gone by untouched it says that too, to the human reading it.

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

// Where this task's plan goes. relay owns the path — it is derived from the
// worktree, so a second agent or a session that started this morning finds the
// same file without being told — and the agent owns what is in it. There is one
// copy and nothing is passed on a command line, which is what lets the list be
// ticked off between documents rather than only when one goes up.
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

// The document goes up with the task's plan under it. The human is assumed to
// know nothing about the task except what relay has shown them, and they read
// this one hours after the last one, so what the work is and how far along it
// has got is relay's to say rather than something the agent has to remember to
// repeat. From here on `sent` is the document as it goes on screen: what is
// diffed against, what is kept, and what the editor opens with.
const task = tasks.taskOf(process.cwd());
// Once ever, and before the first read of the ledger: the rounds that were
// relayed before relay kept one, filed under the tasks they came from. Without it
// every task in flight would be counting from its next round.
tasks.fill();
const past = tasks.rounds(task);
const wrote = plan.read(task);
const now = new Date();

// A plan already under the document — this is a document that came back out of
// `~/.relay` and is being sent again — comes off before the current one goes on.
// Two of them, one of them a round out of date, is worse than either.
sent = plan.append(sent, plan.render(task, wrote, past, now));

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
});
// The window reads this off the ticket. Until it is there the window waits,
// rather than skipping ahead to someone who is already serving.
turn?.serving(relay.url);

process.stderr.write(`relay: waiting for the human — ${relay.url}\n`);
// The one line every caller sees, and the one a timed-out caller is handed.
process.stderr.write(
  "relay: this blocks until they answer — if a command timeout can fire first, run relay in the background\n",
);

// The one place the agent is already reading when it thinks about this task, so
// the one place worth saying it: a plan nobody knows the path of does not get
// written, and one nobody is reminded of stops being true halfway through a day.
// When it has already stopped being true, the line says that instead — the human
// is being told the same thing under the document, and the agent should not learn
// it from their reply.
const behind = wrote ? plan.stale(wrote, past) : 0;
// How many rounds went up after it was last written, this one not counted: it is
// going up now, and it is the one being complained about.
const missed = past.length + 1 - behind;
const where = plan.tilde(plan.file(task));
process.stderr.write(
  !wrote
    ? `relay: this task has no plan — write one at ${where} and every document carries it\n`
    : behind
      ? `relay: the plan under this document has not been touched in ${missed} round${missed === 1 ? "" : "s"} — the human is being told so; update ${where}\n`
      : `relay: the plan under this document is ${where} — keep it current\n`,
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

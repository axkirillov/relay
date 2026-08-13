import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { createTwoFilesPatch, structuredPatch } from "diff";

import { unlatchOnExit } from "./latch.js";
import * as queue from "./queue.js";
import { serve } from "./server.js";
import * as storage from "./storage.js";
import { ensureWindow, watchWindow } from "./window.js";

const usage = `relay <file.md>

Show a markdown document to the human and wait — for as long as it takes — for
their reply. They can edit anywhere in it; their edits are highlighted live
against what you sent.

On accept, the unified diff of their edits is printed to stdout and relay exits
0. If they close the window without replying, relay exits 1 and prints nothing.

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

const args = process.argv.slice(2).filter((a) => a !== "--");
if (args.length !== 1 || args[0] === "-h" || args[0] === "--help") {
  process.stderr.write(usage);
  process.exit(args.length === 1 ? 0 : 2);
}

const path = resolve(args[0]!);
let sent: string;
try {
  sent = await readFile(path, "utf8");
} catch (err) {
  process.stderr.write(`relay: cannot read ${path}: ${(err as Error).message}\n`);
  process.exit(2);
}

const prefill = process.env.RELAY_PREFILL ? await readFile(process.env.RELAY_PREFILL, "utf8") : sent;

const store = storage.open(path, sent);
// Joined before the server comes up, so the line is in the order the relays were
// run. With no window there is nothing to line up for.
const turn = process.env.RELAY_NO_OPEN ? null : queue.enter(store.id, path);

// The round's own directory holds what a long command wrote, beside the document
// it was run from.
const relay = await serve(path, sent, prefill, store.dir);
// The window reads this off the ticket. Until it is there the window waits,
// rather than skipping ahead to someone who is already serving.
turn?.serving(relay.url);

process.stderr.write(`relay: waiting for the human — ${relay.url}\n`);
// The one line every caller sees, and the one a timed-out caller is handed.
process.stderr.write(
  "relay: this blocks until they answer — if a command timeout can fire first, run relay in the background\n",
);

if (turn?.ahead) process.stderr.write(`relay: queued behind ${turn.ahead} — waiting for the window\n`);

// Watched from here, not from the front of the line: closing the window dismisses
// every relay waiting on it, so one that never reached the screen is listening
// for the same thing as the one being read.
const watch = turn ? watchWindow() : null;

let shown = false;
if (turn) {
  // Reaching the head is both when the window shows this document and when this
  // relay becomes the one who has to start a window if none is up. Nothing waits
  // on it — a dismissal in the meantime ends this relay just the same.
  void turn.wait().then(() => {
    // Asked now, not remembered: the window can have been closed in the moment
    // it took to get here, and starting one back up would undo the closing.
    if (watch!.dismissed()) return;
    shown = true;
    ensureWindow(!!process.env.RELAY_DEBUG);
  });
}

const accepted = relay.accepted.then((edited) => ({ edited }));
const dismissed: Promise<null> = watch ? watch.gone.then(() => null) : new Promise(() => {});

let outcome = await Promise.race([accepted, dismissed]);

// The window going and a reply landing can fall within milliseconds of each
// other; a reply already in flight wins.
if (outcome === null) outcome = await Promise.race([accepted, wait(300).then(() => null)]);

// Leaving the line is what moves the window on to the next document, so it goes
// before the diff work rather than after it.
turn?.leave();
watch?.stop();
relay.close();

if (outcome === null) {
  store.abandon();
  process.stderr.write(
    shown
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
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Drop the `Index:`/`====` preamble jsdiff prepends; git-style is enough. */
function clean(patch: string): string {
  return patch.replace(/^(Index:.*\n)?={10,}\n/, "");
}

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { createTwoFilesPatch, structuredPatch } from "diff";

import { unlatchOnExit } from "./latch.js";
import * as queue from "./queue.js";
import { serve } from "./server.js";
import * as storage from "./storage.js";
import { openWindow } from "./window.js";

const usage = `relay <file.md>

Show a markdown document to the human and wait — for as long as it takes — for
their reply. They can edit anywhere in it; their edits are highlighted live
against what you sent.

On accept, the unified diff of their edits is printed to stdout and relay exits
0. If they close the window without replying, relay exits 1 and prints nothing.

If another relay's window is already up, this one waits its turn and opens as
soon as that one is done.

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
// Joined before the server comes up, so the line is in the order the relays
// were run. With no window there is nothing to contend for.
const turn = process.env.RELAY_NO_OPEN ? null : queue.enter(store.id, path);

const relay = await serve(path, sent, prefill);
process.stderr.write(`relay: waiting for the human — ${relay.url}\n`);
// The one line every caller sees, and the one a timed-out caller is handed.
process.stderr.write(
  "relay: this blocks until they answer — if a command timeout can fire first, run relay in the background\n",
);

if (turn?.ahead) process.stderr.write(`relay: queued behind ${turn.ahead} — waiting for the window\n`);
await turn?.wait();

const win = turn ? openWindow(relay.url, !!process.env.RELAY_DEBUG) : null;

const accepted = relay.accepted.then((edited) => ({ edited }));
const abandoned = win ? win.closed.then(() => null) : new Promise<null>(() => {});

let outcome = await Promise.race([accepted, abandoned]);

// Closing the window and accepting can land within milliseconds of each other;
// a reply already in flight wins.
if (outcome === null) outcome = await Promise.race([accepted, wait(300).then(() => null)]);

if (outcome === null) {
  store.abandon();
  await win?.close();
  // The screen is free the moment the window is gone — before the diff work.
  turn?.leave();
  relay.close();
  process.stderr.write("relay: the human closed the window without replying\n");
  process.exitCode = 1;
} else {
  // The window vanishing is the confirmation. Nothing to read, nothing to miss.
  await win?.close();
  // The screen is free the moment the window is gone — before the diff work.
  turn?.leave();
  relay.close();

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

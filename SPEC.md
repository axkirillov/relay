# relay — spec

## What it is

An MCP tool that hands a document to a human and blocks until they reply. The
human edits it freely in a vim-modal editor; their edits are highlighted live
against the original, and the agent gets back a **diff**.

The agent must assume the human knows **nothing** about the task except what
relay has shown them.

## Shape

A single command. All TypeScript, two processes:

```
relay <file.md>  ──> stdout: a unified diff
     │
     └─spawn─> Electron window ──http──> loopback, for the document and the reply
```

**Not an MCP server.** One process per relay, alive for exactly as long as the
human takes, then gone. Nothing to register, nothing running between calls, and
any agent that can run a command can use it — as can a person, by hand.

The cost is that an agent must run it as a background command rather than a
foreground one, because harnesses cap how long a foreground command may take
and a human may not answer for an hour. An MCP wrapper around the same core
stays possible if that ever becomes the wrong trade.

## Flow

1. Agent writes a markdown file, runs `relay <path>`.
2. relay copies it to durable storage and opens the window.
3. The command blocks — forever, if that is what it takes.
4. The human edits **anywhere**: any line, between words, inside a word. There
   are no protected regions and no comment blocks.
5. Their changes are highlighted live, diffed against the original, so it is
   always obvious which text is theirs and which is the agent's.
6. They accept.
7. The window closes and relay prints **a unified diff** to stdout.

## Exit

- **0** — accepted. stdout is the diff, or a line saying nothing changed.
- **1** — the window was closed without a reply. stdout is empty.
- **2** — bad usage, or the file could not be read.

## Accepting is unmistakable

The window closes. That is the confirmation — there is nothing to notice and
nothing to miss.

Ordering matters here, and an earlier build got it wrong: it printed its result
and exited the instant the reply arrived, killing the HTTP server before the
page's request had been answered. The page saw a dead connection, reported a
network error, and stayed open — on a reply that had in fact been delivered.
relay now answers the page, waits for that answer to be flushed, closes the
window, and only then prints and exits.

## Editing is unrestricted

Earlier drafts of this spec made agent text read-only and confined the human to
`<<< USER >>>` blocks, enforced by a CodeMirror transaction filter. **That is
gone.** It was the wrong model: it decided in advance where a remark was allowed
to go. Now every character is editable and the diff records what changed.

## Return value

A unified diff, nothing more. The agent wrote the original, so it knows what was
there; and the original is on disk if it needs to re-read it.

```diff
@@ -3,4 +3,4 @@
 The refresh job hits the 100k cap every run.
-Raise the cap to 250k.
+Fix the query instead — raising it just moves the wall.
```

## Questions are prose

No widgets, no schema. The agent asks in ordinary text; the human answers by
editing. They are never boxed into options the agent thought of.

## Window

- Full display height, roughly 60% of display width, centred.
- Narrow margins — the text column should not be squeezed.
- The title sits to the right of the traffic-light buttons, never under them.

## One window at a time

There is one human and one screen, so a relay started while another is up does
not barge in — it waits, and its window opens the moment the one ahead of it is
answered or closed. The waiting is invisible to the human: windows simply
arrive one after another.

With no daemon to hold a queue, the queue is a directory. Each relay writes a
ticket named for its arrival, `~/.relay/queue/<ms>-<pid>.json`, and the oldest
live ticket has the screen; everyone else polls four times a second. There is
no lock to go stale, and a relay that dies is swept from the line by whoever
notices — its PID no longer answers, or its ticket has stopped being touched
(which is how a PID recycled onto an unrelated process is told from a relay).

The line is per-human, not per-repo: relays from four worktrees share it. FIFO,
no timeout, no cap. Closing a window without replying ends that relay only —
the next one still opens. `RELAY_NO_OPEN=1` skips the queue, having no window
to contend for.

The HTTP server comes up immediately either way, so a queued relay is serving
its document and printing its URL while it waits.

## Storage

```
~/.relay/<timestamp>-<slug>/
  meta.json      # id, source path, opened/accepted times, cwd
  sent.md        # exactly what the agent showed
  accepted.md    # what the human accepted
  diff.patch     # what the agent was told

~/.relay/queue/  # a ticket per relay waiting for the screen
```

## Settled

- **Closing the window is reported to the agent** as such, rather than hanging.
- **A blocked call waits forever.** No timeout.
- **One window at a time, but relays queue.** A second relay waits its turn
  rather than being refused or stacking a window on top of the first.
- **The queue is invisible.** The window does not say how many are behind it.
  The next one appearing is the whole signal.
- **Markdown for v1.** Richer artifact-style documents are the eventual goal,
  but HTML is heavy and models are still poor at SVG, so: markdown now.

## Out of scope for v1

- Rich/HTML documents
- Margin comments anchored to a selection
- Structured JSON return
- Widgets (radio, checkbox, text field)
- Live-preview markdown rendering
- An index UI browsing past relays

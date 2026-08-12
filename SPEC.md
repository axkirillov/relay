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

## A terminal in the window

Half of what an agent asks a human for is a command it cannot run itself, and
alt-tabbing to a terminal is the friction. So the window has one: `⌃\`` opens a
pane at the bottom on a real pty, in the directory relay was run from, and `⌃\``
again crosses back to the document without putting the pane away — `:term` does
that, as does the ✕ in its bar. Colours, TUIs, `⌃C`, `git rebase -i`: a shell,
not a command runner. The pane is opt-in, and nothing is spawned until it is
opened for the first time — the window is a document first, and a terminal that
was always up would change what relay is.

The pty lives in the **CLI process**, not the page. That is forced — the page has
`contextIsolation: true, nodeIntegration: false` and could not spawn a process if
it tried — and it is the good outcome: the CLI is plain node, so `node-pty` loads
the prebuild for the system ABI and nothing has to be rebuilt against Electron's.
The bridge is three routes on the loopback server already there: `GET /pty` is an
event stream of output, `POST /pty/in` is a burst of typing, `POST /pty/size` is
the new size. Base64 on the way out, because a pty speaks in the carriage returns
an event stream is delimited by. Server-sent events rather than a socket upgrade
because it costs no framing code, and the page only ever listens on it.

Everything dies with the window. `relay` kills the shell as it shuts the server,
and if relay is killed outright the pty master closes and the shell gets its
`SIGHUP` from the OS, the way a terminal emulator's children always have.

### Getting what happened in there back to the agent

This is the feature's whole justification, not a nicety. **A pty's scrollback is
not document text, and the diff is relay's only channel back** — so an agent that
asked the human to run something, and got a terminal widget for its trouble, is
no better off than before, and the human is back to copy-pasting.

Two roads out, and they are both the same road the document already uses:

- **`⌘Y` takes the last command and its output into the document** as a fenced
  block, at the caret, where the diff will carry it. With something selected in
  the terminal, it takes the selection instead. This is the one the feature is
  for: one key, from inside the shell, and what the agent asked to see is in the
  reply.
- **A selection in the terminal is a yank.** It goes into vim's unnamed register
  and on to the system clipboard from there, so `p` pastes it into the document
  and `⌘V` pastes it anywhere else — exactly what a yank in the document does.

Which rows are "the last command and its output" is read off the terminal's own
buffer rather than the byte stream, so what comes back is what the human can see:
wrapping resolved, escapes gone, a TUI's redraws collapsed into the screen it
settled on. The region starts at the row the cursor was on when they last pressed
Enter and ends above the prompt the shell has drawn since. A prompt of more than
one line leaves its upper lines inside that region, and there is no shell
integration to ask, so they are recognised instead: a prompt repeats itself, and
what stood above the command when it ran is what to look for at the end of its
output. A prompt that changed in between — the command was a `cd` — is not
recognised and stays, which is the harmless way round. On the alternate screen a
full-screen program has no scrollback to walk, and its screen is the whole of
what it has to say, so that is what is taken.

### Inside the terminal, every key is the shell's

`⌃X` accepts from the document and does nothing in the pane. A shell has its own
uses for `⌃X`, `⌃C`, `⌃D` and the rest, and a terminal that quietly kept a few
back would not be a terminal. The two exceptions are the ones that have to be:
`⌃\`` to leave, and `⌘Y` (`⌃⇧Y` off a Mac) to take — chosen because they are keys
a shell has no use for.

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

## The agent stops waiting the moment the human answers

A harness may enforce the block with a gate of its own — the one here is a hook
that latches when it sees `relay` launched and refuses the agent every tool call
until the latch is gone. relay removes that latch as it exits, however it exits,
so the answer arriving is itself what frees the agent. Nothing has to poll, and
nothing has to notice.

The latch is a file the gate writes before relay starts:
`$RELAY_GATE_STATE/open-$CLAUDE_CODE_SESSION_ID`, under `~/.local/state/relay`
by default. relay takes down only the one it was launched under and only if it
is unchanged since — a relay run by hand latched nothing and takes nothing down
with it, and a round that has already latched again keeps its latch. Where there
is no gate there is no file, and nothing to remove.

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
- **One shell per window, and only if it is asked for.** No tabs, no splits, no
  session to reattach to. The pane exists to answer the question on screen.

## Out of scope for v1

- Rich/HTML documents
- Margin comments anchored to a selection
- Structured JSON return
- Widgets (radio, checkbox, text field)
- Live-preview markdown rendering
- An index UI browsing past relays

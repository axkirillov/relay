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

## Running a command

An agent that wants the human to run something should not be sending them to a
terminal. Any fence whose language is a shell — `sh`, `bash`, `zsh`, `shell`,
`console` — is a command the human can run where it stands: `⌃↵` with the cursor
in the block, or `:run`. Nothing new for an agent to learn, and every document
already sent would have been runnable.

**The output goes into the document.** That is the whole design, and it follows
from the diff being the only channel back: the agent asked for the command
because it wants the answer, so the answer has to be somewhere the diff will
carry it. It lands directly under the command as an ordinary fenced block —

````
```sh
pnpm test
```

````output
 ✓ 34 tests passed
````
````

— which means it is text like any other. The live diff paints it as an addition,
`:res` takes it back out, and the human can trim it before accepting.

Four backticks on the output fence, because output containing a ``` fence of its
own would otherwise end the block early.

**Nothing runs on its own.** A command runs when the human presses the key, it
runs the text they can see, and running the same block twice replaces that
block's old output instead of stacking a second copy under it.

**Run and capture, not a terminal.** stdin is closed, so a command that asks a
question is answered with end-of-file rather than hanging on a prompt nobody can
see. It runs in the relay's own cwd — the directory the agent asked from. stdout
and stderr are merged, because that is the order they happened in. A non-zero
exit adds `[exit 3]`; `⌃C` stops it and adds `[stopped]`.

Long output is **folded, not truncated**: past twenty lines the head is replaced
by a notice the human can click, while every line stays in the document. The
agent gets all of it; the fold only decides how much the human scrolls past.
`:raw` shows the lot.

Output too long to belong in a document at all **goes to a file instead**. Past a
hundred lines — or 64 KB, since one line of minified javascript would flood the
document without reaching a hundred of anything — the run writes to
`~/.relay/<round>/run-N.log`, and the document keeps the first hundred lines, a
pointer naming that file, and the last twenty. The start says what the command
set out to do and the end says how it turned out, which between them is usually
the whole answer; the file has every line for when it is not. The pointer is
written the moment the spill starts rather than at the end, so a `⌃C` cannot leave
a cut-off block with no file named. The fold hides that pointer along with the
rest of the head, so the notice standing in its place names the file too — the one
output the document did not keep whole is never the one with nothing on screen
saying where the rest of it went. Output that would never end is capped at 8 MB
— a bound on the disk, not the document — and the command is stopped there and
told so.

Nothing a relay started outlives the relay. The response *is* the run — there is
no run id and nothing to poll — so the page hanging up is the human's ⌃C, and
closing the window kills whatever is still going.

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

A run block answers what the agent thought to ask. It cannot answer what the
human thinks of next — the command that was nearly right, the one that needs a
question answered, the `git rebase -i` — and alt-tabbing to a terminal for those
is the friction. So the window has one: `⌃\`` opens a
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

## `gf` opens the file, in their own neovim

A relay document is full of `src/cli.ts:42`, and until now every one of them was
a thing to go and look at somewhere else. `gf` on one opens **a real neovim, in
this window, on that file, on that line** — their config, their LSP, their
plugins. `:q` and it is gone, and they are back in the document with their edits
and their cursor exactly where they left them.

Three cheaper things were on the table first — a read-only peek rendered in the
window, pushing the file to the nvim next door in tmux, and `open` — and all
three were turned down for the same reason: what is wanted at that moment is
*an editor*, and the human already has one they have spent years on.

So this is not a viewer, and the spec should not imply one. It is their nvim on
the real file: they can change it, `:w` it, and that is a consequence of what was
asked for rather than a hole in it.

**It is nvim's own pty, not a shell that runs nvim.** The difference is what
happens when they quit: the process ends, the pty ends, the pane goes. A shell in
between would still be sitting there afterwards, holding a prompt in a pane that
was supposed to disappear. nvim by name rather than `$EDITOR`, because what was
asked for was *their neovim*, and `$EDITOR` is as likely to be something that
opens a window of its own or has no use for `+42`.

**A second pty, beside the shell's.** The most likely moment for a `gf` is while
reading something in the terminal pane, so refusing one then would be refusing it
exactly when it is wanted; and taking the shell's pty away would kill whatever it
was in the middle of. So nvim gets its own, the shell keeps running behind it,
and the pane it was occupying comes back when nvim quits. This is not the tabs
and splits the terminal pane rules out — there is still one shell, and this one
lives for one file.

### What counts as a path

The path-ish text under the cursor — or, if the cursor is not on one, the next
one along the line, which is what vim does and what makes `gf` a key rather than
an aiming exercise. A path in prose arrives wrapped, in backticks, in a markdown
link, in quotes, in a table cell, with the sentence's full stop stuck to the end,
and none of that wrapping is part of the name; so none of it is in the class of
characters a path is made of, and `` `src/cli.ts` ``, `[cli](src/cli.ts)` and a
bare `src/cli.ts` all come out the same. In visual mode the selection is the
path, which is the way out of a name this cannot pick out of prose.

`:42` is honoured, and `:42:7` takes the column too. vim splits that across `gf`
and `gF`; there is no reason here to want the line thrown away, so both keys do
the same thing and a hand that learnt either need not remember which.

Paths resolve against the directory relay was run from — the same one a `⌃↵`
command runs in — with `~` and absolute paths as written. **No file, no jump**: a
line in the footer saying what was looked for, nothing opened and nothing
created. A directory counts, because nvim opens one as a listing and vim's own
`gf` does the same.

**There is no allow-list, and the absence is deliberate.** Pictures get one,
because a picture's path never comes back off the wire and the agent named every
file it meant; a path the human's cursor is on comes back off the wire by
definition. There is also nothing to protect: it is their machine, their key, and
they can already run any command they like in this window with `⌃↵` or the shell
pane. Being shown a file is strictly less than that.

### Inside nvim, every key is nvim's

Even more so than in the shell — `⌃X`, `⌃C`, `⌃D`, `⌃R`, `⌃W`, `⌃O` all mean
something in there. So `⌃X` does not accept and `⌃↵` does not run while nvim has
the pane, and `gf` inside nvim is nvim's own, which is why a second one of these
can never be opened from in there.

Two keys are kept back, the same two the shell pane keeps:

- **`⌃\`` crosses to the document and back**, without disturbing nvim. The
  document is on screen the whole time — the pane leaves it room deliberately —
  so a reply can be typed with the file still up.
- **`⌘Y` takes the selection into the document.** nvim usually has the mouse, so
  ⇧-drag is what selects rows for the terminal rather than for nvim; those rows
  land in the document as a fenced block, the same crossing the shell pane's take
  is. There is no "last command" in an editor, so without a selection there is
  nothing to take.

There is no third, and in particular no ✕ and no `:term`: **closing this pane is
`:q`**, which is nvim's word for it and already in their hands. A pane that could
be dismissed out from under a buffer with unsaved changes would be a way to lose
work quietly.

Accepting the relay while nvim is still open kills it along with everything else
the window started. That is SIGHUP, which is the signal nvim has always taken as
"the terminal is going" — it writes its swap file on the way out, so the recovery
nvim itself offers next time is there.

### Inside the terminal, every key is the shell's

`⌃X` accepts and `⌃↵` runs a block; from the pane they do nothing. A shell has
its own uses for `⌃X`, `⌃C`, `⌃D` and the rest, and a terminal that quietly kept
a few back would not be a terminal. The two exceptions are the ones that have to be:
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
- **`gf` opens the human's real editor, not a preview of the file.** A viewer
  would have been cheaper and was turned down.

## Out of scope for v1

- Rich/HTML documents
- Margin comments anchored to a selection
- Structured JSON return
- Widgets (radio, checkbox, text field)
- Live-preview markdown rendering
- An index UI browsing past relays

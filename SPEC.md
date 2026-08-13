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

## Reviewing a diff

An agent that wants a patch read should not be sending the human to a review
tool. Any fence whose language is `diff` or `patch` is a review where it stands:
a wash the full width of each line by what the line is, the file strip and `@@`
headers set apart as structure, and the file's own line numbers in the gutter —
`refresh.ts:1004`, not "the 41st line of what you sent me". Nothing new for an
agent to learn, and every diff already pasted into a document would have been
reviewable.

**The view is paint, and the text underneath is untouched.** Everything else this
window renders — tables, HTML, images, folded output — swaps the source for a
widget and puts it back when the caret arrives, which is exactly why none of them
can be edited where they stand. A diff must not work that way, because the point
of showing one is that the human writes into it. So nothing is replaced: the
lines stay the characters the agent sent and only their colour is added.
Live-editability is not built, it is what is left by not replacing anything, and
vim motions, the live diff and `:res` all keep working inside a patch because as
far as they are concerned nothing happened.

**The first character of the line says what the human's typing is.** A unified
diff line opens with `+`, `-` or a space — that is the diff's own rule, not one
relay invents — so a line that opens with none of them is not part of the patch,
and there is only one thing it can be:

| What the human types | What it is |
| --- | --- |
| Text changed inside a line still starting with `+`, `-` or a space | An edit to that line of the patch |
| A new line starting with `+` | Code they want added |
| A line starting with anything else | A comment |

Press `o` and type: the line starts at column 0 with no marker, so it is a
comment, and it is painted yellow as it is written. Nothing to learn and nothing
to switch on. The cost is a comment written as a bullet — `- why no timeout
here?` — which opens with a marker and so comes out red as a deletion; the human
watches that happen an inch from the cursor rather than finding out later, which
is the trade against making every comment carry a sigil.

**relay does not keep the block a patch that would still apply.** A comment line
is precisely what breaks that, and the human's edits are read by the agent rather
than applied by relay.

## Return value

A unified diff — and, where the human left comments in a `diff` block, a list
saying where each one is.

```diff
@@ -3,4 +3,4 @@
 The refresh job hits the 100k cap every run.
-Raise the cap to 250k.
+Fix the query instead — raising it just moves the wall.
```

The agent wrote the original, so it knows what was there; and the original is on
disk if it needs to re-read it.

The comments come back through a second part of the answer because the diff
cannot tell them apart from the human's edits — both arrive as added lines, and
telling them apart is the whole point of the marker column. So they are named
where they belong, counted from the `@@` header they sit under:

```
# comments left in the diff
src/refresh.ts:1004  why 30s and not the poll interval
```

Exact rather than guessed at: a comment is a line the patch has no room for, and
the headers above it say which file and which line it is against.

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
  diff.patch     # the patch the agent was told, and only the patch

~/.relay/queue/  # a ticket per relay waiting for the screen
```

Comments left in a diff are not stored beside it: they are lines of
`accepted.md`, and reading them back out of it later is the same parse that put
them in the answer.

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
- Margin comments anchored to a selection. A comment in a `diff` block is an
  ordinary line of the document rather than an anchor into one, which is why it
  needs no margin to live in and no selection to hang from.
- Folding long runs of context inside a diff. It was considered and dropped: a
  fold is a replace decoration, and replacing lines inside the one block whose
  whole point is that its lines stay editable text is the wrong direction to
  push this in for a patch of reviewable size.
- Structured JSON return
- Widgets (radio, checkbox, text field)
- Live-preview markdown rendering
- An index UI browsing past relays
- A real terminal in the window — a PTY, with TUIs and commands that ask
  questions. Its own feature, on its own branch; run-and-capture above is the
  answer to "the agent wants me to run something".

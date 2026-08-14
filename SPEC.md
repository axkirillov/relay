# relay — spec

## What it is

An MCP tool that hands a document to a human and blocks until they reply. The
human edits it freely in a vim-modal editor; their edits are highlighted live
against the original, and the agent gets back a **diff**.

The agent must assume the human knows **nothing** about the task except what
relay has shown them.

## Shape

A single command. All TypeScript, two kinds of process:

```
relay <file.md>  ──> stdout: a unified diff
     │                    ▲
     │ a ticket           │ http on loopback — the document, and the reply
     ▼                    │
  the line ──head──> one Electron window
```

The window belongs to no relay. Whichever one finds none up starts it, and it
shows whoever is at the head of the line. When the line runs dry it puts up a
blank of its own rather than quitting, so the key that starts a task always has
a window to be pressed in.

**Not an MCP server.** One process per relay, alive for exactly as long as the
human takes, then gone; the window outlives the relay that started it. What runs
between calls is one relay holding a blank document, which is the same process
every other document arrives in rather than a daemon of a second kind — there is
still nothing to register, and any agent that can run a command can use it, as
can a person, by hand.

The cost is that an agent must run it as a background command rather than a
foreground one, because harnesses cap how long a foreground command may take
and a human may not answer for an hour. An MCP wrapper around the same core
stays possible if that ever becomes the wrong trade.

## Flow

1. Agent writes a markdown file, runs `relay <path>`.
2. relay copies it to durable storage and takes its place in the line.
3. The window shows it — at once if the line was empty, otherwise when the
   documents ahead of it have been answered.
4. The command blocks — forever, if that is what it takes.
5. The human edits **anywhere**: any line, between words, inside a word. There
   are no protected regions and no comment blocks.
6. Their changes are highlighted live, diffed against the original, so it is
   always obvious which text is theirs and which is the agent's.
7. They accept.
8. The document leaves the screen and relay prints **a unified diff** to stdout.

## Exit

- **0** — accepted. stdout is the diff, or a line saying nothing changed — or,
  for a document the human started themselves, the text they wrote.
- **1** — the window was closed without a reply, or a blank was accepted empty.
  stdout is empty.
- **2** — bad usage, or the file could not be read.

## Accepting is unmistakable

The document goes. Either the next one is there in its place or a blank is;
either way what was on screen is gone, and that is the confirmation — there is
nothing to notice and nothing to miss.

Ordering matters here, and an earlier build got it wrong: it printed its result
and exited the instant the reply arrived, killing the HTTP server before the
page's request had been answered. The page saw a dead connection, reported a
network error, and stayed open — on a reply that had in fact been delivered.
relay now answers the page, waits for that answer to be flushed, and only then
leaves the line, prints and exits. Leaving the line last is what hands the
window to the next document rather than to an empty screen.

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
`:raw` shows the lot, and `:fold` — or `zc` — puts an opened one back.

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

**A patch is shown as the code it patches.** A diff mode paints two colours and a
marker column, which is not what a reviewer reads: they read the file. So the
markers come off, what is left is parsed in the language of the file the hunk is
from, and the colours land on the real characters — the same TypeScript, or PHP,
that the same lines would be anywhere else in the document. Added and removed are
said by the wash under the line and by nothing else, and the `+`/`-` stay in the
text but are dimmed to the colour of the gutter numbers.

**Which means the file strip is worth writing.** The `--- a/path` and `+++ b/path`
pair is what names the language, per file, and it is the same pair the comments
come back through — without it a comment reads `why 30s` with no file in front of
it. Both halves out of two lines an agent already has. For a fragment quoted with
no headers at all, the fence's own second word answers instead — ` ```diff php ` —
and where a file's extension is one this editor has no language for, its hunks are
left unpainted rather than painted as something else.

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

## A task the human starts

Every relay above came from an agent: it wrote a file, ran the command, and a
human answered. This is that arrow reversed. **`⌘N`** — `⌃⇧N` off a Mac, the way
`⌘Y` already has a twin — or **`:new`** puts up a document nobody sent, and what
the human writes in it starts a session that was not running. A sentence, a
paragraph, a pasted Slack or Jira link: whatever is enough for an agent to work
from, in their own words, with nobody to be brief for.

**The gesture is in the window, not in tmux.** A key binding somewhere else
would mean leaving the window to use it, and the window is what is in front of
them at the moment the thought arrives — they are already reading a document
when they remember the other thing. (A command palette is the obvious home for
this and for `:run`, `:res` and the rest; it is a feature of its own and not
this one.)

**Accepting it hands the text to a command.** There is no diff, because nobody
wrote an original to diff against: every character is theirs, so the whole
document is the answer and stdout is the text itself. Then relay runs
`~/.relay/task` — `$RELAY_TASK` overrides — with the round's directory as its
one argument, where `accepted.md` is what was written.

**relay knows nothing about repos, worktrees or tntcs, and must not.** Which
repository a task belongs to, whether it needs a worktree, how a session is
opened on it — those are one person's conventions, and a document editor that
knew them would be the wrong tool holding them. The hook is where they live. It
is also the second reversal this feature asks for: relay runs a command of the
human's on their behalf, which nothing in the design did before. It is a
one-line contract in both directions, and relay does not wait for it.

**An empty accept costs nothing.** No command, no session, and no round left on
disk — pressing the key and changing your mind has to be free, or the key
becomes a thing to be careful with.

### A task jumps the line

The line is FIFO among agents, and stays that way: four agents that asked in an
order are answered in it. A task the human wrote is not one of those. It goes
to the front, because they made it a second ago and it is what they are thinking
about — waiting behind an agent's document for their own would be the tool
arguing with them.

Among tasks the **newest** wins, which is what makes pressing the key twice do
the obvious thing: hand them a fresh blank rather than the one they half-wrote
and set aside. The one they set aside is still there, one place behind.

### The window stops leaving

When the line runs dry the window no longer quits — it puts up a blank of its
own instead. This reverses *"the window is not permanent"*, and it follows from
the gesture: a key that starts a task is worth nothing if the window it lives in
has just disappeared, and the moment the line empties is exactly when the next
thing to ask for comes to mind.

An automatic blank and a blank the human asked for are the same document and
differ only in standing. The automatic one is **shown without being brought
forward** — nothing has happened, so taking the screen would be a lie — and it
is replaced the instant anything else is queued. Unless they have typed in it:
one character promotes it to a task they made, and from then on it holds the
screen and waits its turn like any other. That promotion is why the draft is
saved *while* they type rather than when the document leaves — and why the very
first edit is saved at once rather than after the usual pause. The pause is a
trailing one and never elapses while they are still typing, so a blank waiting
for it would spend a whole typing burst still yielding the screen; the first save
goes immediately and the rest wait, because promotion only has to happen once.

Promotion is not permanent, because what earned it can be taken back. Delete
every character and the document stands where it entered the line again: the
window's own blank goes behind everything, and a blank the human asked for stays
in front, since they asked for it a moment ago and its being empty is no reason
to make them wait. That is the same judgement made on accept, where a task
submitted empty is thrown away rather than acted on.

The old quit survives as the failure path. If the blank cannot be put up — the
one relay that was going to hold it never started — the window gives it five
seconds and then goes, rather than sitting on an empty screen forever.

### Half-written text survives being set aside

A document that loses the screen keeps what was typed in it and opens on it
again when it comes back. This was not free and it was worth it: without it,
`⌘N` over a half-written reply would silently spend it, and a key that can
destroy what you were writing is a key you use carefully rather than freely.

`⌘N` saves before it asks — the save is awaited, then the new document is
requested, so the order is sequenced rather than raced. A document leaving for
any other reason saves as it goes, which is best-effort by nature: the page is
being destroyed, and what the browser will still send at that point is a beacon,
not a promise. Between the two there is the save while typing, which the blank's
promotion needs anyway, so the window a best-effort save could lose is the
typing of the last moment rather than the paragraph.

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
- **`⌘Y` takes the selection into the document.** nvim has the mouse, so a plain
  drag is nvim's own visual selection; the drag that selects rows for the
  terminal instead is **`⌥-drag` on a Mac and `⇧-drag` everywhere else** — that
  is xterm's own override and it is not the same key on both, which is why the
  footer says whichever one is theirs. Those rows land in the document as a
  fenced block, the same crossing the shell pane's take is. There is no "last
  command" in an editor, so without a selection there is nothing to take.

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

## `gx` opens the link, wherever they open links

A URL in a relay document was dead text. The address a paragraph is *about* — the
ticket, the build, the page being asked about — had to be read off the screen and
retyped into a browser by hand. `gx` is vim's own key for it and does what vim's
does: hands the link under the cursor to whatever this machine opens links with.

**The CLI opens it, not the window.** The page is sandboxed and the window has no
handler for opening one either, so a link goes out over the same loopback bridge
nvim comes back on. `open` on a Mac, `xdg-open` elsewhere — the machine's own
default rather than a browser named here — spawned with the address as one
argument. Nothing puts it near a shell: an address is data, and a `$(…)` in a
query string is a character of it and not a command.

**Four schemes, named rather than filtered.** `https`, `http`, `file` and
`mailto`, plus the bare `www.` a browser's address bar would take, which leaves
as https. An allow-list, because `javascript:` and `data:text/html` are what must
never reach a machine's opener and naming what is wanted is the only way to be
sure of that. The rule is in the page and again in the CLI: what arrives over the
wire is not the page's word for anything.

Nothing of this happens in the window — the browser is somewhere else entirely —
so the footer is the whole of the feedback, and it waits until the opener has
taken the link before it says it went. An opener that refuses says so there.

**And the footer says the key exists**, next to `gf` where the rest of them are.
A URL was not dead text for want of a way to open it — nobody had been told there
was one — so a `gx` that only the spec knows about is the same silence in a new
coat.

### What counts as a link

The same reading `gf` does of a path: the link under the cursor, or the next one
along the line, with the wrapping the document put around it left behind — an
autolink's `<>`, a markdown link's parentheses, backticks, a table cell, the
sentence's full stop, the `**` of emphasis. Where an address ends is its own
business, so a bracket it opened itself stays: `.../Fold_(higher-order_function)`
comes out whole, while the `)` that closes `[fold](…)` does not. In visual mode
the link is looked for *inside* the selection rather than demanded of it — what a
hand selects around an address is as likely to be the sentence it sat in.

**`gx` alone, where `gf` has `gF`.** That pair is vim's own and relay collapses
it; `gX` is not a key any hand has learnt, and inventing one is not the same
thing.

**No link, nothing opened**: a line in the footer and no more, which is the
answer `gf` gives to the same question. A link under `gf` is told it is one
rather than looked for as a file — the two keys are a shift apart and the
document has both kinds of thing in it.

## Window

- Full display height, roughly 60% of display width, centred.
- Narrow margins — the text column should not be squeezed.
- The title sits to the right of the traffic-light buttons, never under them.

## Always one window

There is one human and one screen, so there is one window — not one at a time,
one. Every document goes through it, oldest first. A relay started while another
is up does not barge in and does not open a second window; it waits, and its
document appears in the window already there the moment the one ahead of it is
answered.

An earlier build gave each relay its own window and let them queue. That is what
this replaces, and the reason is what the human said: *"when I press alt-tab I
see too many active relay windows and I don't know which one is on top of the
stack — which one needs to be reviewed first."* Four relays should be four
documents in a row, not four windows to sort through. There is no ordering
problem left to have: what is on the screen is what to read.

The window appears with the first document and stays. It used to go once the
last one was answered; it now holds a blank instead, for the reasons under
*The window stops leaving*.

### The line

With no daemon to hold a queue, the queue is a directory. Each relay writes a
ticket named for its arrival, `~/.relay/queue/<ms>-<pid>.json`, holding the URL
its document is served at and what standing it has. The head live ticket is the
one on screen; everyone polls. There is no lock to go stale, and a relay that
dies is swept from the line by whoever notices — its PID no longer answers, or
its ticket has stopped being touched (which is how a PID recycled onto an
unrelated process is told from a relay).

Three standings, and they are an ordering rather than a priority scheme with
knobs: a **task** the human wrote is ahead of everything, newest first; an
agent's document is next, oldest first; a **blank** the window put up on its own
is behind everything and is replaced the moment anything else is queued. A blank
that has been typed in stops being one — its relay rewrites its own ticket as a
task — which is the whole mechanism behind promotion, and emptying it again
rewrites the ticket back to the standing it entered with.

The line is per-human, not per-repo: relays from four worktrees share it. No
timeout, no cap. `RELAY_NO_OPEN=1` skips the line, having no window to contend
for. The HTTP server comes up immediately either way, so a queued relay is
serving its document and printing its URL while it waits.

### Nobody owns the window

The window follows the line rather than being handed a document. It reads the
line eight times a second, loads whatever is at the head, and surfaces itself
every time that changes — a document arriving in a window already open is the
one thing this feature exists to make obvious. A blank is the exception, and the
only one: it is loaded like anything else and shown without being surfaced,
because nothing has arrived.

The first poll that finds the line empty starts a blank rather than quitting, and
then no other for three seconds — a relay takes a moment to write its ticket, and
every tick until it has still reads as an empty line. It spawns it the way
anything else starts a relay — the command, detached, from the human's home
directory — and then waits for it in the line like any other document. Five
seconds without one appearing means it is not coming, and the window quits after
all; that is the old behaviour kept as the failure path rather than a second
design.

Whichever relay is at the head starts a window if none is up; `~/.relay/window.json`
is the window saying it is here, kept fresh by a heartbeat, and the head relay
keeps looking, so a window that dies violently is simply replaced. Electron's
single-instance lock is the backstop under all of that, not the plan.

This also fixes something the old design could not. A window used to be spawned
and killed by one relay, so a relay that was itself killed — a harness timeout,
a session ending — never ran the kill, and left a window on the screen with
nobody to answer it. Now the window quits when the line runs dry, and a killed
relay's ticket goes stale within seconds.

### Closing dismisses everything

Closing the window dismisses every relay in line, not only the document on
screen. It is the human saying *get these off my screen*, and a queued document
opening in its place would be the opposite of that. The relay that was being
read exits 1 saying the window was closed on it; the ones still waiting exit 1
saying they never reached the screen.

The close is durable, not observed. The window writes `~/.relay/closed` on its
way out — the time, and the URL of what it was showing — before it takes down
`window.json`. A relay is dismissed by a close later than its own arrival, so an
old tombstone can never touch a new relay and nothing needs clearing. This
matters because a document can arrive and be closed on between two of a relay's
polls: watching for the window to disappear misses that, and the relay that
misses it is the one that starts a window the human has just shut. The URL is
there for the same reason — the window is the only one who knows whose document
was on screen when it went, so it says so rather than leaving each relay to
guess from what it happened to see.

A window that dies without writing a tombstone — `kill -9`, a crash — is not a
close. Nobody is dismissed, and the head relay puts a new window up.

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
  meta.json       # id, source path, opened/accepted/drafted times, cwd
  sent.md         # exactly what the agent showed
  accepted.md     # what the human accepted — for a task, the whole of it
  draft.md        # what they had typed when the document left the screen
  diff.patch      # the patch the agent was told, and only the patch

~/.relay/queue/   # a ticket per relay waiting for the screen
~/.relay/window.json  # the window, while it is up: pid, and a heartbeat
~/.relay/closed   # the last close: when, and what was on screen
~/.relay/task     # what to run when the human wrote the document themselves
~/.relay/window/  # Electron's userData, including its single-instance lock
```

Comments left in a diff are not stored beside it: they are lines of
`accepted.md`, and reading them back out of it later is the same parse that put
them in the answer.

The timestamp counts seconds, which used to be enough to tell two rounds apart
and no longer is: the window puts up a blank the moment the line drains, and the
key that starts a task fires whenever it is pressed. So the directory is claimed
rather than assumed — `mkdir` without `recursive`, which refuses an existing
name and refuses it atomically, and the loser of a tie takes `-2`. The stakes
are higher than a clash of names: a shared directory means one round's document
lands on the other's, and either one being discarded takes both away.

`RELAY_QUEUE_DIR` moves all of it, the window included — the one handle a test
needs to put a whole relay somewhere private, rather than each path being
overridable on its own.


## Settled

- **Closing the window is reported to the agent** as such, rather than hanging.
- **A blocked call waits forever.** No timeout.
- **Always one window.** Not one at a time — one. Every document goes through
  it, and a second relay never puts a second window on the screen.
- **The window stays.** It comes with the first document and then holds a blank
  when the line runs dry, because a key that starts a task needs a window to be
  pressed in. This reverses *"the window is not permanent"*, which stood here
  until the human asked for that key.
- **relay may run a command of the human's.** An accepted task is handed to
  `~/.relay/task`. Nothing else in the design has relay acting on its own
  behalf, and this is the deliberate exception: the alternative was teaching a
  document editor about repositories.
- **One document at a time.** The next appears the moment the current one is
  answered. No tabs, no list of what is waiting.
- **Closing the window dismisses everything**, not only the document on screen.
  Chosen against the recommendation at the time, and deliberately: it is the
  "get them all off my screen" gesture.
- **The queue is invisible.** The window does not say how many are behind it.
  The next one appearing is the whole signal.
- **Markdown for v1.** Richer artifact-style documents are the eventual goal,
  but HTML is heavy and models are still poor at SVG, so: markdown now.
- **One shell per window, and only if it is asked for.** No tabs, no splits, no
  session to reattach to. The pane exists to answer the question on screen.
- **`gf` opens the human's real editor, not a preview of the file.** A viewer
  would have been cheaper and was turned down.
- **`gx` hands the link to the machine**, rather than relay having any opinion
  about which browser or opening one in the window. What it will hand over is an
  allow-list of schemes, checked in the page and again in the CLI.

## Out of scope for v1

- Rich/HTML documents
- Margin comments anchored to a selection. A comment in a `diff` block is an
  ordinary line of the document rather than an anchor into one, which is why it
  needs no margin to live in and no selection to hang from.
- Folding long runs of context inside a diff. It was considered and dropped: a
  fold is a replace decoration, and replacing lines inside the one block whose
  whole point is that its lines stay editable text is the wrong direction to
  push this in for a patch of reviewable size.
- A command palette. `:new`, `:run`, `:res`, `:raw` and the rest have earned one
  between them, and it is the natural way to find a key you have not learnt yet
  — but it is a feature about all of them rather than part of any one, so it
  waits.
- Structured JSON return
- Widgets (radio, checkbox, text field)
- Live-preview markdown rendering
- An index UI browsing past relays

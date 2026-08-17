# relay

A CLI that hands a markdown document to a human and blocks until they answer.

```
relay <file.md>
```

The relay window comes up with the document in a modal (vim) editor. The human
edits it anywhere they like; their edits are highlighted live against what the
agent sent. On accept the document leaves the screen and the unified diff of
their edits is printed to stdout.

- exit **0** — accepted; stdout is the diff, or `no changes — the human accepted
  the document as written` when they changed nothing
- exit **1** — the window was closed without a reply; stdout is empty
- exit **2** — bad usage, or the file could not be read

The document is rendered, not shown as source: markdown tables, HTML and inline
SVG are drawn in place, so a diagram or a chart written into the document arrives
as a picture. Images do too — `![](shot.png)` beside the document, or an `https:`
one. `:raw` toggles the whole thing back to source and out again.

A command the agent wants run can be run in the window. Put the cursor in any
shell fence — ```` ```sh ````, `bash`, `zsh`, `shell`, `console` — and press
`⌃↵` (or `:run`); its output streams in directly below as a ```` ````output ````
block, so the diff carries it back. `⌃C` stops it, running the block again
replaces its last output, and `:res` takes an output you would rather not send
back out. Long output is folded to its last twenty lines — every line is still
there. Clicking the `… N earlier lines` notice opens the fold, `zc` or `:fold`
closes it again, and `:raw` shows the lot. Output longer than a document should
hold goes to `~/.relay/<round>/run-N.log` instead, and the block keeps its first
hundred lines, a pointer to that file, and its last twenty.

In the window: `⌃X` or `ZZ` accepts — `:w`, `:wq`, `:x` and `:acc` do too — `:q`
closes without replying, and `:res` puts a stretch of the document back the way
it arrived: the cursor line in normal mode, the selection in visual mode, or a
range like `:12,18res`. Lines are numbered so they can be pointed at in a reply.
Whatever a yank or a delete takes reaches the system clipboard as well as vim's
own register — vim's `clipboard=unnamed` — so what `y` picks up leaves the window
with you.

## Reviewing a diff

A ```` ```diff ```` block is a review you can write in. Edit the patch where it
stands, and any line you write that does not open with a diff marker is a
comment — those come back to the agent under the diff, each one located as
`file:line`, so a remark beside a hunk arrives knowing which line it is about.

## gf opens the file

Put the cursor on a path in the document — `src/cli.ts`, `` `src/cli.ts` ``,
`[cli](src/cli.ts)`, all the same — and press `gf` (`gF` does the same thing).
Your own neovim opens in the window on that file, with your config, and
`src/cli.ts:42` lands on line 42.
`:q` and it is gone; the document is underneath the whole time with your edits
and your cursor where you left them.

It is your nvim on the real file, so you can change it and `:w`. Inside it every
key is nvim's, except `⌃\`` to cross to the document and back, and `⌘Y` to take a
selection into your reply — `⌥-drag` to select on a Mac, `⇧-drag` elsewhere,
since a plain drag is nvim's own. If there is no such file nothing opens and the
footer says what it looked for.

## gx opens the link

Put the cursor on a link — `https://example.com/x`, `<https://example.com/x>`,
`[the ticket](https://example.com/x)`, all the same — and press `gx`. It opens
wherever your machine opens links. A link further along the line is still the one
that opens, so the cursor does not have to be placed just so.

`https`, `http`, `file` and `mailto` count, and a bare `www.example.com` goes out
as https. Nothing else does: a `javascript:` in a document is text and stays
text. If there is no link under the cursor the footer says so, and nothing opens.

## The terminal

`⌃\`` opens a real shell at the bottom of the window, in the directory relay was
run from — for everything a run block cannot do: colours, TUIs, `⌃C`, `git rebase
-i`, a command that asks a question. `⌃\`` again crosses back to the document
with the pane still up; `:term` opens and closes it. Inside it every key belongs
to the shell, so `⌃X` does not accept and `⌃↵` does not run from there.

The point of it is getting what happened back to the agent, which only ever sees
the diff:

- **`⌘Y`** (`⌃⇧Y` off a Mac, or `:take`) puts the last command and its output
  into the document as a fenced block, at the cursor. With something selected in
  the terminal it takes the selection instead.
- **Selecting in the terminal is a yank** — vim's register and the system
  clipboard both — so `p` pastes it into the document.

The shell dies with the window. There is one per window, it is not started until
the pane is opened, and there is nothing to reattach to.

There is one relay window, and every document goes through it. Start a relay
while another is up and it waits its turn; its document appears in the same
window the moment the one ahead of it is answered. Four agents asking at once is
one window and four documents in a row — never four things in your alt-tab, and
never a doubt about which one to read first. Closing the window dismisses them
all: it is the gesture for clearing the screen, not for skipping one document.

The window is nobody's in particular. Whichever relay finds none up starts it,
and it stays for the ones behind, then goes on its own once the line is empty —
so no MCP server, no daemon and no registration. One process per relay, for as
long as the human takes, and nothing left running between calls. Any agent that
can run a command can use it.

## Install

Node 22 or newer, and pnpm. Then a clone, a build, and a link from anywhere on
your PATH:

```sh
git clone https://github.com/axkirillov/relay
cd relay
pnpm install
pnpm build
ln -s "$PWD/dist/relay.js" ~/.local/bin/relay
```

`relay <file.md>` from anywhere after that. The build leaves `dist/` beside the
source and the link points into it, so the clone stays where it is and
`git pull && pnpm build` is the upgrade. macOS and Linux; the window is Electron
and the shell is a real pty, so neither is a Windows story.

## Build

```
pnpm install
pnpm build        # dist/relay.js, dist/shell.cjs (the window), and the editor bundle
pnpm check        # types
pnpm test         # the line arithmetic behind :res, the queue, the window's presence, a real pty
pnpm smoke        # end to end, no window
pnpm smoke:pty    # a shell on demand, keys in, output out, gone with the relay
pnpm smoke:goto   # a real nvim on the file under the cursor, gone when it quits
pnpm smoke:open   # the link under the cursor out to the machine's opener, whole and as data
pnpm smoke:queue  # two relays, one window, in turn — opens a real window briefly
pnpm smoke:dismiss # closing the window dismisses the queued relay too
pnpm smoke:latch  # the agent's gate latch lifts on every way out of a relay
```

The last three put a real window on the screen for a few seconds and take the
focus. They also outlast most command timeouts — run them in the background.

`RELAY_NO_OPEN=1` serves the document without opening a window, and skips the
queue with it.
`RELAY_DEBUG=1` lets the window's own output through to stderr.
`RELAY_PREFILL=<file>` opens the editor on `<file>` while still diffing against
the document — so the diff view can be looked at without typing into it.

Every relay is kept in `~/.relay/<timestamp>-<slug>/` — the agent only gets a
diff back, so what it was diffed against has to live somewhere. Beside it,
`~/.relay/queue/` holds a ticket per relay waiting for the screen,
`~/.relay/window.json` is the window saying it is up, and `~/.relay/closed`
records the last time the human closed it. `RELAY_QUEUE_DIR` moves the lot — a
test pointed at a temp directory takes the window with it.

See [SPEC.md](SPEC.md).

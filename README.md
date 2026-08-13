# relay

A CLI that hands a markdown document to a human and blocks until they answer.

```
relay <file.md>
```

The relay window comes up with the document in a modal (vim) editor. The human
edits it anywhere they like; their edits are highlighted live against what the
agent sent. On accept the document leaves the screen and the unified diff of
their edits is printed to stdout.

- exit **0** — accepted; stdout is the diff
- exit **1** — the window was closed without a reply; stdout is empty
- exit **2** — bad usage, or the file could not be read

A command the agent wants run can be run in the window. Put the cursor in any
shell fence — ```` ```sh ````, `bash`, `zsh`, `shell`, `console` — and press
`⌃↵` (or `:run`); its output streams in directly below as a ```` ````output ````
block, so the diff carries it back. `⌃C` stops it, running the block again
replaces its last output, and `:res` takes an output you would rather not send
back out. Long output is folded to its last twenty lines — every line is still
there, and `:raw` shows them all. Output longer than a document should hold goes
to `~/.relay/<round>/run-N.log` instead, and the block keeps its first hundred
lines, a pointer to that file, and its last twenty.

In the window: `⌃X` or `ZZ` accepts, `:q` closes without replying, and `:res`
puts a stretch of the document back the way it arrived — the cursor line in
normal mode, the selection in visual mode, or a range like `:12,18res`. Lines
are numbered so they can be pointed at in a reply. Whatever a yank or a delete
takes reaches the system clipboard as well as vim's own register — vim's
`clipboard=unnamed` — so what `y` picks up leaves the window with you.

There is one relay window, and every document goes through it. Start a relay
while another is up and it waits its turn; its document appears in the same
window the moment the one ahead of it is answered. Four agents asking at once is
one window and four documents in a row — never four things in your alt-tab, and
never a doubt about which one to read first. Closing the window dismisses them
all: it is the gesture for clearing the screen, not for skipping one document.

The window is nobody's in particular. Whichever relay finds none up starts it,
it stays for the ones behind, and it quits itself once the line is empty — so no
MCP server, no daemon, no registration, and nothing left running between calls.
One process per relay, for as long as the human takes. Any agent that can run a
command can use it.

## Build

```
pnpm install
pnpm build        # dist/relay.js, dist/shell.cjs (the window), and the editor bundle
pnpm check        # types
pnpm test         # the line arithmetic behind :res, the queue, and the window's presence
pnpm smoke        # end to end, no window
pnpm smoke:queue  # two relays, one window, in turn — opens a real window briefly
pnpm smoke:dismiss # closing the window dismisses the queued relay too
```

The last two put a real window on the screen for a few seconds and take the
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

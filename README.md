# relay

A CLI that hands a markdown document to a human and blocks until they answer.

```
relay <file.md>
```

A window opens with the document in a modal (vim) editor. The human edits it
anywhere they like; their edits are highlighted live against what the agent
sent. On accept the window closes and the unified diff of their edits is printed
to stdout.

- exit **0** — accepted; stdout is the diff
- exit **1** — the window was closed without a reply; stdout is empty
- exit **2** — bad usage, or the file could not be read

A command the agent wants run can be run in the window. Put the cursor in any
shell fence — ```` ```sh ````, `bash`, `zsh`, `shell`, `console` — and press
`⌃↵` (or `:run`); its output streams in directly below as a ```` ````output ````
block, so the diff carries it back. `⌃C` stops it, running the block again
replaces its last output, and `:res` takes an output you would rather not send
back out. Long output is folded to its last twenty lines — every line is still
there, and `:raw` shows them all.

In the window: `⌃X` or `ZZ` accepts, `:q` closes without replying, and `:res`
puts a stretch of the document back the way it arrived — the cursor line in
normal mode, the selection in visual mode, or a range like `:12,18res`. Lines
are numbered so they can be pointed at in a reply. Whatever a yank or a delete
takes reaches the system clipboard as well as vim's own register — vim's
`clipboard=unnamed` — so what `y` picks up leaves the window with you.

Relays queue. Start one while another window is up and it waits its turn, then
opens the moment the one ahead of it is answered or closed — so two agents
asking at once become two windows in a row, never two at the same time.

No MCP server, no daemon, no registration: one process per relay, for as long as
the human takes. Any agent that can run a command can use it.

## Build

```
pnpm install
pnpm build      # dist/relay.js and the editor bundle
pnpm check      # types
pnpm test       # the line arithmetic behind :res, and the queue
pnpm smoke      # end to end, no window
pnpm smoke:queue # two relays at once — opens real windows briefly
```

`RELAY_NO_OPEN=1` serves the document without opening a window, and skips the
queue with it.
`RELAY_DEBUG=1` lets the window's own output through to stderr.
`RELAY_PREFILL=<file>` opens the editor on `<file>` while still diffing against
the document — so the diff view can be looked at without typing into it.

Every relay is kept in `~/.relay/<timestamp>-<slug>/` — the agent only gets a
diff back, so what it was diffed against has to live somewhere. The queue is
`~/.relay/queue/`, a ticket per relay waiting for the screen.

See [SPEC.md](SPEC.md).

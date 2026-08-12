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

In the window: `⌃X` or `ZZ` accepts, `:q` closes without replying, and `:res`
puts a stretch of the document back the way it arrived — the cursor line in
normal mode, the selection in visual mode, or a range like `:12,18res`. Lines
are numbered so they can be pointed at in a reply. Whatever a yank or a delete
takes reaches the system clipboard as well as vim's own register — vim's
`clipboard=unnamed` — so what `y` picks up leaves the window with you.

## The terminal

`⌃\`` opens a real shell at the bottom of the window, in the directory relay was
run from — so a command an agent wants run does not need another window. It is a
pty, not a command runner: colours, TUIs, `⌃C`, `git rebase -i`. `⌃\`` again
crosses back to the document with the pane still up; `:term` opens and closes it.
Inside it every key belongs to the shell, so `⌃X` does not accept from there.

The point of it is getting what happened back to the agent, which only ever sees
the diff:

- **`⌘Y`** (`⌃⇧Y` off a Mac) puts the last command and its output into the
  document as a fenced block, at the cursor. With something selected in the
  terminal it takes the selection instead.
- **Selecting in the terminal is a yank** — vim's register and the system
  clipboard both — so `p` pastes it into the document.

The shell dies with the window. There is one per window, it is not started until
the pane is opened, and there is nothing to reattach to.

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
pnpm test       # the line arithmetic behind :res, the queue, a real pty
pnpm smoke      # end to end, no window
pnpm smoke:pty  # a shell on demand, keys in, output out, gone with the relay
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

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
there, and `:raw` shows them all. Output longer than a document should hold goes
to `~/.relay/<round>/run-N.log` instead, and the block keeps its first hundred
lines, a pointer to that file, and its last twenty.

In the window: `⌃X` or `ZZ` accepts, `:q` closes without replying, and `:res`
puts a stretch of the document back the way it arrived — the cursor line in
normal mode, the selection in visual mode, or a range like `:12,18res`. Lines
are numbered so they can be pointed at in a reply. Whatever a yank or a delete
takes reaches the system clipboard as well as vim's own register — vim's
`clipboard=unnamed` — so what `y` picks up leaves the window with you.

## gf opens the file

Put the cursor on a path in the document — `src/cli.ts`, `` `src/cli.ts` ``,
`[cli](src/cli.ts)`, all the same — and press `gf`. Your own neovim opens in the
window on that file, with your config, and `src/cli.ts:42` lands on line 42.
`:q` and it is gone; the document is underneath the whole time with your edits
and your cursor where you left them.

It is your nvim on the real file, so you can change it and `:w`. Inside it every
key is nvim's, except `⌃\`` to cross to the document and back, and `⌘Y` to take a
selection into your reply — `⌥-drag` to select on a Mac, `⇧-drag` elsewhere,
since a plain drag is nvim's own. If there is no such file nothing opens and the
footer says what it looked for.

## The terminal

`⌃\`` opens a real shell at the bottom of the window, in the directory relay was
run from — for everything a run block cannot do: colours, TUIs, `⌃C`, `git rebase
-i`, a command that asks a question. `⌃\`` again crosses back to the document
with the pane still up; `:term` opens and closes it. Inside it every key belongs
to the shell, so `⌃X` does not accept and `⌃↵` does not run from there.

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
pnpm smoke:goto # a real nvim on the file under the cursor, gone when it quits
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

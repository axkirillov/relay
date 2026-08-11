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

No MCP server, no daemon, no registration: one process per relay, for as long as
the human takes. Any agent that can run a command can use it.

## Build

```
pnpm install
pnpm build      # dist/relay.js and the editor bundle
pnpm check      # types
pnpm smoke      # end to end, no window
```

`RELAY_NO_OPEN=1` serves the document without opening a window.
`RELAY_DEBUG=1` lets the window's own output through to stderr.
`RELAY_PREFILL=<file>` opens the editor on `<file>` while still diffing against
the document — so the diff view can be looked at without typing into it.

Every relay is kept in `~/.relay/<timestamp>-<slug>/` — the agent only gets a
diff back, so what it was diffed against has to live somewhere.

See [SPEC.md](SPEC.md).

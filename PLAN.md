# relay v1 — build plan

Requirements are in [SPEC.md](SPEC.md) and are settled. This is *how*.

## Stack

| piece | choice | why |
|---|---|---|
| MCP server | `github.com/mark3labs/mcp-go` v0.57.0 | your other three MCP servers all use it |
| HTTP server | stdlib `net/http` | no router needed for four routes |
| Editor | CodeMirror 6 + `@replit/codemirror-vim` 6.4.0 | real vim; the maintained CM6 vim fork |
| Markdown | `@codemirror/lang-markdown` 6.5.2 | syntax tree for styling + block motions |
| Bundler | `esbuild` 0.28.2 → `go:embed` | one command, no config file, still one binary |

Go 1.25.6, Node 24, pnpm 10.32 — all present.

## Layout

```
relay/
  main.go                    flags; default = MCP over stdio
  internal/
    mcpsrv/server.go         the `relay` tool; blocks on a channel
    web/server.go            ephemeral port, 4 routes, embeds dist/
        session.go           one in-flight relay: doc + done chan
    store/store.go           ~/.relay/<id>/{meta.json,sent.md,accepted.md}
    launch/open.go           `open` (darwin) / `xdg-open`
  ui/
    src/main.ts              editor assembly
    src/protect.ts           transaction filter — agent text is read-only
    src/userblock.ts         o / O / ]u / [u, block tinting
    src/commands.ts          :accept, ZZ
    build.mjs                esbuild → internal/web/dist/
  Makefile                   make ui && make build
```

Four routes: `GET /r/{id}` (page), `GET /assets/*`, `GET /r/{id}/doc` (raw
markdown), `POST /r/{id}/accept` (full buffer text → unblocks the agent).

No websocket in v1. Nothing pushes to the page after it loads.

## The one genuinely hard part

**How do human blocks live in the buffer, and how is agent text protected?**

Chosen: **one document, markers literally in the text.** The buffer contains

```
<<< USER >>>
is this new? it wasn't like this in July
<<< /USER >>>
```

A CodeMirror `changeFilter` rejects any edit whose range falls outside a USER
block's interior. The buffer text *is* the return value — no reassembly step,
nothing to get out of sync.

The rejected alternative was holding user blocks as CM6 widget decorations over
an untouched agent document. Cleaner in theory; in practice vim motions across
widget boundaries misbehave and every block needs its own nested editor.

**Trade-off you should know about:** the marker lines are visible as literal
text in v1. USER blocks get a tinted background and a left bar from day one, so
agent and human text never blur — but you *will* see `<<< USER >>>` on screen.
Hiding them behind a thin rule needs atomic-range decorations, which also
governs how the cursor steps over them. That is a second pass, not v1.

## Milestones

| # | what | why this order |
|---|---|---|
| M1 | Go skeleton: MCP tool blocks, serves the doc as plain `<pre>`, one Accept button, returns the text | proves the blocking loop end-to-end in the smallest possible thing you can actually try |
| M2 | CodeMirror + vim + markdown styling + read-only filter | the editor, still with no USER blocks |
| M3 | USER blocks: `o` / `O`, tint, `]u` / `[u`, `:accept` / `ZZ` | the actual product |
| M4 | `~/.relay/` durable storage, `meta.json` | needs a real accepted doc to store |
| M5 | Polish: flash on rejected edit, theme, error paths | |

M1 is worth stopping at — it is the first point you can call `relay` from an
agent and watch it wait for you.

## Two smaller calls, already made

- **The built JS bundle gets committed.** Otherwise `go install
  github.com/axkirillov/relay@latest` produces a binary with no UI in it.
- **One `relay` process per MCP client**, own ephemeral port. No daemon, no
  port contention, no cross-session state.

## Open question that lands at M1

SPEC.md's **escape hatch** question becomes real the moment the blocking loop
exists: what happens when you close the tab instead of accepting? The other two
(timeout, concurrent relays) can wait.

# A real terminal inside the relay window

Your job, in this worktree, on branch `feat/terminal-pane`.

## What relay is

A CLI that hands a markdown document to a human and blocks until they answer.
`relay <file.md>` opens an Electron window holding the document in a vim-modal
CodeMirror editor; the human edits it anywhere; on accept the window closes and
relay prints a **unified diff** of their edits to stdout. Read `README.md` and
`SPEC.md` before anything else — SPEC.md is the source of truth for intent, and
it is kept current as a matter of course.

Two processes, and the boundary between them decides this feature:

```
relay <file.md>          ── plain node, spawns the window, serves loopback HTTP
     └─spawn─> electron shell/main.cjs ──http──> the page (ui/src/*)
```

The page is sandboxed — `shell/main.cjs` sets `contextIsolation: true,
nodeIntegration: false`. It cannot spawn a process or require a native module.
Anything that touches the OS lives in the CLI process and is reached over the
loopback server in `src/server.ts`.

## The feature

An embedded terminal in the relay window: a real PTY, in a pane the human can
open, use, and dismiss. Colours, TUIs, `⌃C`, commands that ask questions,
`git rebase -i`. A genuine shell, not a command runner.

The motivation is the one you'd expect: when an agent asks the human to run
something, alt-tabbing to a terminal is the friction. This is the heavy,
complete answer to that.

## Decided already

- **The PTY lives in the CLI process, not the renderer.** That is forced by the
  sandbox above — and it is good news: the CLI is plain `node`, so `node-pty`
  compiles against the system node ABI. **No `electron-rebuild`.** Bridge it to
  the page over a WebSocket (or chunked POST/SSE pair) on the existing loopback
  server. Keep `node-pty` `external` in `build.mjs` the way `electron` already is.
- **`xterm.js` in the page** for the terminal itself.
- **It starts in the relay's cwd** — `src/storage.ts` already records
  `process.cwd()` in `meta.json`; that is the worktree the asking agent works in.
- **The pane is opt-in and dismissable.** The window is a document first. A
  terminal that is always up would change what relay is.
- **It dies with the window.** No surviving processes, no daemon; relay's whole
  design is one process for exactly as long as the human takes.

## The tension you must solve, not dodge

**A PTY's scrollback is not document text, so nothing in it reaches the agent.**
Relay's only return channel is the diff of the document. An agent that asked the
human to run something asked *because it wants the output* — and if that output
lives in a terminal widget, the agent gets none of it and the human is back to
copy-pasting.

So the pane needs a first-class way to put terminal output **into the document**,
where the diff will carry it. Design that path deliberately; it is the feature's
whole justification, not a nicety. Two threads to pull:

- `ui/src/main.ts` already patches vim's register controller so every yank and
  delete reaches the **system clipboard** (`clipboard=unnamed`). A selection in
  the terminal could ride the same road, and paste into the document is then just
  `p`.
- Something more direct — a key that takes the last command and its output and
  drops it into the document as a fenced block, at the cursor.

Say in `SPEC.md` which you chose and why.

## The other half of this, being built in parallel — do not build it

A sibling worktree (`~/repos/worktrees/relay/run-blocks`, branch
`feat/run-blocks`) is adding the *lightweight* path at the same time: any shell
fence in the document becomes runnable in place — `⌃Enter` runs the block under
the cursor, output is captured and inserted into the document as a sibling
fenced block (truncated in the rendered view, full in the source), streaming,
run-and-capture, no PTY.

**Boundary, so the two merge cleanly:**

| Yours | Theirs |
| --- | --- |
| `xterm.js` pane, layout, its own PTY route | shell fences in the document |
| `node-pty` in the CLI | `POST /run`, spawn-and-capture, no PTY |
| Getting terminal output *into* the document | Inserting captured output below a fence |

Both of you touch `src/server.ts` (a new route), `ui/src/main.ts` (a keybinding),
and `SPEC.md`. Expect small conflicts there and keep your changes narrow so they
stay small. Do not touch the document-insertion path they own, and do not make
shell fences runnable — that is theirs.

## How to work here

- `pnpm build` (esbuild → `dist/relay.js` + `dist/assets/relay.js`), `pnpm check`
  (types), `pnpm test` (plain node test files), `pnpm smoke` (end to end, no
  window), `pnpm smoke:queue`, `pnpm smoke:latch`.
- `RELAY_NO_OPEN=1` serves without a window. `RELAY_DEBUG=1` lets the window's
  stderr through. `RELAY_PREFILL=<file>` opens the editor on another file while
  still diffing against the document.
- **The installed `relay` on PATH is a shim that execs the _main checkout's_
  `dist/relay.js`** — so building here proves nothing about a real round. To try
  yours, run `node ~/repos/worktrees/relay/terminal-pane/dist/relay.js <doc>`
  directly.
- The repo is **local-only — there is no remote.** Branch off local `main`;
  nothing to push.
- Add tests in the existing style (`*.test.ts` run by plain node, no framework).
- House style: comments explain *why*, never *what*; no comment unless it earns
  its place. Match the prose voice of `SPEC.md` and the existing sources.

## Verifying it by hand

Driving the editor is a solved problem here — see `scripts/` and the memory of
how it is done: `RELAY_NO_OPEN=1` plus an Electron harness that sends real keys,
reads the clipboard, and takes screenshots. A terminal pane is exactly the kind
of thing that looks fine and is broken, so verify it with real keystrokes in a
real window before you call it done, and screenshot it.

## When you are done

Update `SPEC.md` and `README.md`, keep `pnpm check` and `pnpm test` green, commit
on `feat/terminal-pane`, and report back what you built and what you decided.
Do not merge to `main` — the human will.

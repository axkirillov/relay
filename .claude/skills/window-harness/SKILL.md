---
name: window-harness
description: Drive relay's real window with real key events to verify a UI change end to end. Use when a change touches ui/src — the editor, vim keys, decorations, rendering, or what the accepted diff carries — and unit tests cannot show whether it works for a human.
---

# Verifying a change in a real window

relay's unit tests check pure functions. They cannot tell you whether a keystroke
reaches the editor, whether a decoration is on screen, or whether the diff the
agent gets back carries what the human saw. For that, drive the real window.

Write the harness fresh for the change you are making — it is a throwaway, and it
belongs in your scratchpad, not in the repo. What is worth keeping is below: every
one of these cost a failed run to learn.

`reference/harness.cjs` is a working scaffold with the helpers already correct.
Copy it, add your own checks at the bottom, delete it when you are done.

## Run it

```sh
"$(cat scratchpad/electron.path)" scratchpad/mycheck.cjs scratchpad/doc.md scratchpad/shots
```

- **Get the Electron binary path once and cache it in a file.** `node -e
  'console.log(require("electron"))'` can print a download banner onto stdout and
  poison the path. Check what you cached before using it.
- **Create the screenshot directory before the run.** A missing directory throws
  inside an async handler, and an unhandled rejection does not exit Electron — the
  harness sits there alive and silent until something kills it.
- **Run it in the background and write to a log file.** A window harness outlives
  most command timeouts, and a timeout kills the call while `tail` still holds
  every line of progress in its buffer, so you learn nothing about where it got to.
- **Give the whole run a deadline.** Every silent-hang mode below ends the same
  way — Electron alive, log empty, nothing to read. One harness sat like that for
  eighty minutes before anyone looked. A `setTimeout` that prints and calls
  `app.exit(1)` turns that into a line you can act on.
- **`capturePage` hands back a stale frame when the window has lost the screen.**
  Two shots taken seconds apart came back byte-identical, showing a state the DOM
  had already left. `win.focus()`, `app.focus({ steal: true })`, and about a second
  to settle before capturing. The DOM reads are the assertions; the picture is only
  worth taking if it is the picture of now.

## Driving the shared window, not one of your own

The above builds its own `BrowserWindow`. To test the window itself — the frame
every document goes through, the handover between two relays, the quit when the
line runs dry — you want the real one. `require("<worktree>/dist/shell.cjs")`
into your own Electron process: it runs the real shell in-process, so
`BrowserWindow.getAllWindows()[0]` is the actual window and `capturePage` and
`executeJavaScript` reach it.

- **Do not set `RELAY_NO_OPEN` here.** It is right for the editor harness and
  wrong for this one: with it there is no ticket, no line, and nothing to show.
  The relays must queue for real.
- **Nothing spawns a second window**, because requiring the shell makes *your*
  process the one holding `window.json` — every relay reads a window as already
  up and leaves it alone.
- **Seed the line before requiring the shell**, or it quits on the grace timer
  before your relays are up. Write a ticket named for a time well in the past
  with your own PID: `line()` counts you as alive without a heartbeat (`alive`
  short-circuits on `pid === process.pid`), and a ticket with no `url` is a head
  the window waits on rather than shows. Delete it when you want the first real
  document on screen.
- **`RELAY_QUEUE_DIR` takes the whole relay somewhere private** — queue, window
  file, tombstone, Electron's `userData` and its single-instance lock. Without
  it you are fighting the human's own window for the lock.

## Spawn the relay from inside the harness

```js
spawn("node", ["dist/relay.js", doc], {
  cwd: repo,
  env: { ...process.env, RELAY_NO_OPEN: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
```

- **The installed `relay` runs the main checkout's `dist`.** A worktree build
  proves nothing about it — say `node <worktree>/dist/relay.js` and build first.
- **`RELAY_NO_OPEN=1` is not optional.** Without it the relay joins the queue and
  waits behind whatever real window a human has open, and opens a second window
  you are not driving. With it, relay serves the document and opens nothing.
- **The harness must own the relay.** A relay backgrounded from a separate shell
  call is gone by the next one.
- **Pass the document as an absolute path.** `cwd: repo` is the checkout, so a
  relative path resolves inside it and the relay exits before serving anything.
  `resolve()` the argv paths at the top rather than trusting where you were stood
  when you launched the harness.
- **The URL comes off stderr**, matched with `/http:\/\/127\.0\.0\.1:\d+\//`.
- **Settle that promise on the relay's exit too.** Waiting only for the URL means
  any relay that dies first — bad path, bad document, a port it cannot have — hangs
  the harness forever instead of telling you why. Reject on `exit` with the stderr
  collected so far.
- **Read the diff off the relay's stdout.** Ending with a real `⌃X` accept and
  asserting on that diff is the only assertion that tests what the agent gets.

## Send keys the way the editor hears them

- **Printable keys need three events: `keyDown`, `char`, `keyUp`, in that order.**
  A `keyDown` alone reaches a vim normal-mode binding but never an input or insert
  mode. Normal-mode keys are fine with `keyDown`/`keyUp`.
- **Pace them.** ~45–60 ms between keys, and ~150 ms to settle before `Enter`, or
  the ex and search panels drop the last character.
- **Open an ex or search prompt as its own event first**, then wait ~250 ms before
  typing the body.
- **The keystroke that opens a prompt is the one that gets lost — about one fresh
  window in five.** Measured over ten windows: `/` never arrived twice, the panel
  never opened, and the caret sat on line 1. The pause after the opener does not
  prevent it, because the opener itself is what went missing.
- **So prove the keys landed before you believe anything about the feature.** Read
  the prompt's own input — `document.querySelector(".cm-vim-panel input").value` —
  while it is still open, and read the caret's line after `Enter`. With those two,
  the same run that fails tells you whether it was the command or the delivery: 48
  of 48 `:fold` and `zc` attempts worked whenever the prompt held what was typed,
  and every failure was a caret that had never moved. Without them a lost `/` reads
  exactly like a broken fold.
- **Relay says so when the caret is wrong.** A footer reading `no command here …` is
  the product being right about a harness mistake, not a feature that broke. Read
  the footer before suspecting the feature.

## Read the document off the screen, not out of CodeMirror

```js
Array.from(document.querySelectorAll(".cm-line")).map((l) => l.textContent).join("\n");
```

`.cm-content` carries no `cmView`, so the `EditorView` is not reachable from the
page — there is no way to ask the editor for its state. The DOM is what you have.

- **Navigate by `/pattern` search, never by line number.** CodeMirror keeps only
  the viewport in the DOM, so a line index read from it is an index into whatever
  happens to be on screen. This is also why the read above returns the visible
  document rather than the whole of it: assert on patterns, not on line counts.
- **A decoration that is in the document can still be absent from the DOM** — the
  viewport follows streaming output down, and the widget above it is dropped. Take
  it as a fact about the screen, not about the feature: search or `gg` it back into
  view first, and never let `querySelector(...)` be dereferenced unguarded, since
  the throw lands in an async handler and leaves Electron alive and silent.
- **A click sent past the window's edge is dropped, and it blurs the editor.**
  After that `⌃↵` still works — it is a window-level listener — while every vim
  key silently goes nowhere, which reads exactly like a broken feature. Scroll the
  target in (`zt`, else `scrollIntoView`) and assert it is inside the scroller
  before clicking.

## Driving a pane with a program in it

- **Never send a synthetic ⌃-key immediately before an ex command.** After a
  `sendInputEvent` of ⌃↵, the very next `:` is swallowed and the command never
  runs; one ordinary key in between clears it. This costs two whole runs if you
  read it as what it looks like — `:q` not closing the pane — and it survives
  swallowing the key in the page, which is how you can tell it is the synthetic
  input pipeline and not the code under test.
- **`.xterm-rows` reads empty while the screen plainly shows the text.** The row
  divs are there and their `textContent` is not. Take a screenshot before
  believing a terminal is blank — the picture is the assertion, and a "pane
  never painted" conclusion off the DOM alone is worth nothing.
- **A pane that failed to close poisons every check after it.** Keys meant for
  the document go to the program instead, and later assertions pass and fail at
  random. Assert the pane is down before starting the next round, and give each
  question its own nvim rather than one long session.
- **To select in a pane while a program holds the mouse, ⌥-drag on a Mac** —
  xterm's force-selection modifier is ⇧ everywhere else, but on a Mac it is ⌥
  and only with `macOptionClickForcesSelection` on. A ⇧-drag there selects
  nothing at all, which reads as a broken take.

## Watching what a command spawned

- **`pgrep -f "sleep 30"` matches the shell `pgrep` itself runs in.** Write the
  pattern so it cannot match itself: `sleep 3[0]`.
- **zsh execs into the last command of `sh -c "a; b"`**, so the wrapper's argv
  loses the earlier text. To find the wrapper later, do not put the long-running
  command last.

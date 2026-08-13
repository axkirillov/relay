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

## Watching what a command spawned

- **`pgrep -f "sleep 30"` matches the shell `pgrep` itself runs in.** Write the
  pattern so it cannot match itself: `sleep 3[0]`.
- **zsh execs into the last command of `sh -c "a; b"`**, so the wrapper's argv
  loses the earlier text. To find the wrapper later, do not put the long-running
  command last.

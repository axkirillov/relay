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
- **The URL comes off stderr**, matched with `/http:\/\/127\.0\.0\.1:\d+\//`.
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
- **An ex command that silently does nothing is usually a dropped keystroke, not a
  broken binding.** The same `:fold` passed, failed, and passed again across three
  runs. Read the mode indicator and the footer note straight after the prompt, so
  the harness tells you whether the command ran at all before you go looking for
  the bug in the feature.

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

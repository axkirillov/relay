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
every document goes through, the handover between two relays, what it does when
the line runs dry — you want the real one. `require("<worktree>/dist/shell.cjs")`
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
  file, tombstone, Electron's `userData` and its single-instance lock, and the
  round directories. Without it you are fighting the human's own window for the
  lock. It also puts the **task hook** out of reach, which is what stops an
  accepted blank spawning a real session.
- **To time an arrival to the millisecond, write the ticket yourself.** The window
  only ever reads the queue directory, so a hand-written `{pid, since, rank, url}`
  under `<ms>-<pid>.json` *is* an arrival — use your own pid and `alive()` counts
  it without a heartbeat. Point its `url` at a relay started with
  `RELAY_NO_OPEN=1`, which serves a real document without joining the line. This
  is the only way to land an arrival inside a debounce window; spawning a real
  relay costs an unpredictable second.
- **Which document is on screen is `location.href`, not a DOM guess.** Compare it
  against the urls the relays printed. An empty blank's `.cm-line` text is
  legitimately `""`, so "the page has booted" must be
  `!!document.querySelector(".cm-content")` — a non-empty-text probe waits forever
  on a blank.
- **Ask the relay what it is holding, over HTTP.** `GET <url>/prefill` returns the
  draft it has saved, from outside the page entirely. It is the only way to tell
  "the beacon never fired" from "the keystroke never landed" once the page that
  had the words is gone.
- **`executeJavaScript` never settles if the page navigates while it is in
  flight.** Two runs sat at exactly that await until the deadline fired, and both
  times it was a *failure-detail* read — `document.getElementById("note")
  .textContent` — taken right after the key that loads the next document, so the
  harness hung while explaining itself rather than while testing anything. Race
  every DOM read against a timeout, especially the ones that only run when a
  check has already failed.
- **`isFocused()` is worthless in a harness that never owns the screen.** Every
  window reads back unfocused whatever the shell did, so "it did not steal the
  focus" and "it announced itself" both failed while both behaviours were
  correct. Patch the window's own `focus` / `show` / `showInactive` and
  `app.focus` and count the calls instead — requiring the shell in-process is
  what makes that reachable.
- **Run it invisibly, and swallow the focus rather than passing it on.** Driving
  the real shell means the real `surface()` fires, which drags the run in front of
  whatever the human is doing — they asked for it to stop. Three things together,
  and the whole suite still passed unchanged:
  - `app.on("browser-window-created", (_e, w) => w.setOpacity(0))`. Invisible, not
    hidden: an opacity-0 window still composites, so the DOM updates and keys
    land. Never showing it risks the renderer being throttled as a background
    window.
  - Count `focus` and `app.focus` **without calling through**. Counting was always
    the assertion; calling through is only what raises the app.
  - Keep `show` / `showInactive` / `loadURL` calling through — the page has to
    actually render.
- **Taking the OS focus was never what made the keys land; the caret being in the
  editor is.** Two rounds' keystrokes went nowhere after a document loaded over
  another, and `win.focus()` + `app.focus({steal:true})` appeared to fix it. What
  fixes it without touching the human's screen is
  `document.querySelector(".cm-content").focus()` plus a beat to settle. Do that
  after every navigation, before believing a key went missing.
- **Keys still go missing sometimes, and a dropped keystroke is indistinguishable
  from a regression.** Across four runs of the same suite: one round reached
  `INSERT` and typed nothing, another landed 5 of 30 keys, a third never reached
  `INSERT` at all — 13 and 10 downstream checks failed, every one of them reading
  like the feature was broken, when the code had behaved correctly for the empty
  document that actually existed. Two habits make that legible instead of
  alarming: assert what landed as its own check right where you typed it, and
  print the DOM text in the failure detail of every check that depends on it. Then
  a bad run is one glance rather than a re-investigation. Judge a feature on the
  rounds whose keys arrived, and say how many that was.
- **Drop the screenshots in an invisible run.** There is no picture worth taking,
  and `capturePage` on a window that does not own the screen stalls — which costs
  the round, since the window's heartbeat goes stale while it does.
- **`capturePage()` can stall for minutes, and the window's heartbeat goes stale
  while it does.** Every waiting relay then concludes the window died and exits,
  so the picture costs you the round. One run lost 212 seconds and its agent
  relay that way. Race the screenshot against a short timeout and treat a missed
  picture as nothing — the DOM reads are the assertions.

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

## Asserting on colour, not on a class name

A line's class says what relay thinks the line is. It says nothing about whether
the line came out looking like code. For that, read the spans and their computed
colours:

```js
Array.from(line.querySelectorAll("span"))
  .filter((s) => !s.querySelector("span"))   // leaves only
  .map((s) => ({ text: s.textContent, cls: s.className, color: getComputedStyle(s).color }));
```

- **Leaves only, or a nested span is counted twice.** A token span can hold
  another, and the question is what a reader sees.
- **A HighlightStyle's classes are opaque** — `ͼ14`, and the number moves when a
  rule is added. So assert on the computed colour and take the expected value
  from theme.ts's palette (`#bb9af7` reads back as `rgb(187, 154, 247)`). The
  fixed `cm-…` classes are the ones worth naming.
- **Count the distinct colours on the line.** "Three or more" is the one
  assertion that says *code* rather than *a coloured line*, and it survives the
  grammar tagging something differently than you guessed.
- **A missing span is a token the grammar never tagged, not a bug in your paint.**
  `@codemirror/lang-php` tags a class name where it is a type and nowhere else —
  `Order::`, `new Order`, `instanceof Order` come back with no tag at all. Two
  checks were written against a guess about this and failed. Before believing the
  feature is wrong, parse the same line with the bare parser under node and dump
  every range: if the gap is there too, it is upstream.

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
- **The caret's line comes off the native selection, not off `.cm-cursor`.**
  `drawSelection` paints the cursor into a layer it hides whenever the editor is
  unfocused, and a hidden element's `getBoundingClientRect()` is all zeroes — so
  a nearest-line-by-rect read silently answers "line 1" for every position in the
  document. The DOM selection is still at the cursor; walk its `focusNode` up to
  the enclosing `.cm-line`. Six checks reported the caret in the wrong place while
  the feature under test was working perfectly, and the footer's own answer was
  what proved the caret had been right all along.
- **A line's `textContent` is not the line's text.** The live diff renders what the
  human deleted as an inline widget inside the line they deleted it from, so an
  edited line reads back as the old text and the new text run together —
  `source.abortstop()` for a line the document has as `source.stop()`. Two runs
  were spent concluding that `ciw` was broken in relay's window before the
  accepted patch showed the edit had been perfect all along. Drop every node whose
  class matches `cm-relay-del` when reading a line, and trust the accepted diff
  over the DOM when they disagree.
- **Search for something that occurs only where you mean to go.** `/abort` matched
  the word in the document's prose first, so every key after it landed in a
  paragraph forty lines above the diff — and the checks that followed reported the
  feature broken in six different ways. Log the mode and the visible line range
  after each navigation; a nav that quietly went nowhere otherwise reads as a
  broken feature.
- **Say what each screen is supposed to hold, rather than one rule for all of
  them.** Over a 2,805-line review, "there is diff on this screen" is false at the
  top, where the summary is, and "everything is painted" is false over a patch of
  a `.md` file, which has no language on purpose. Three checks failed saying so,
  and none of them was about the feature. Give every stop its own expectation.
- **To measure anything about scrolling, the document must be taller than the
  window.** Two runs compared a gutter before and after scrolling to a diff that
  had been on screen the whole time, which is nothing measured twice. Assert that
  the thing is off screen first — then the measurement means something.
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

## Standing in for a program relay would spawn

To keep a real browser (or anything else with a window) off the screen, put a
stand-in of the same name first on the relay's `PATH` and assert what it recorded
— `scripts/open.sh` has the pattern.

- **`chmod +x` it, and check that you did.** `which()` requires the execute bit
  and skips what has not got it *in silence*: the real `open` is next on the
  `PATH`, so every footer still reads `opened …`, the log stays empty, and the
  human gets a browser tab per check. A file written by an agent is mode 644.
  One `statSync(…).mode & 0o111` at the top of the harness, before a single key
  is sent, is the difference between a bug and five tabs.
- **Set its log path in the relay's env, not the harness's.** The stand-in is
  spawned by the relay, so `FAKE_OPEN_LOG` has to be in the env passed to
  `spawn("node", ["dist/relay.js", …])`. A stand-in that cannot write its log
  exits non-zero, which relay correctly reports as the opener refusing.

## Watching what a command spawned

- **Never `pkill -f relay.js`.** The human's own relays are `node
  ~/repos/axkirillov/relay/dist/relay.js`, so that pattern reaches every agent
  waiting on the window and each one reports back that the human closed it. Kill
  by the pid you spawned, or match on something only your run has — the queue
  directory, an env var, the document's own path.
- **`pgrep -f "sleep 30"` matches the shell `pgrep` itself runs in.** Write the
  pattern so it cannot match itself: `sleep 3[0]`.
- **A harness that dies without sweeping leaves an Electron holding the
  single-instance lock**, and the next run exits 0 with an empty log — which
  reads as a run that did nothing rather than one that never started. Sweep on
  every exit path, the deadline included, and kill by the pids on your own
  private queue's tickets: they are the relays you spawned and nobody else's.
- **zsh execs into the last command of `sh -c "a; b"`**, so the wrapper's argv
  loses the earlier text. To find the wrapper later, do not put the long-running
  command last.

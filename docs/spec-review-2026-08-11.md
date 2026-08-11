2026/08/11 10:51:59 [relay] open at http://127.0.0.1:64894/r/5c1914946ad3ff79
# relay — spec

## What it is

An MCP tool that turns a markdown file into an interactive document the human
reads and annotates in a browser. The tool call **blocks** until the human hits
Accept, then returns the document with their annotations in place.

<<< USER >>>
It works, but, I want each line to be commentable
<<< /USER >>>

The point: give the agent a real channel to the human. The agent must assume the
human knows **nothing** about the task except what relay has shown them.

## Shape

One Go binary. Two faces:

<<< USER >>>
Do we need a go binary if we are writing a typescript frontend?
<<< /USER >>>

```
relay (single binary)
├─ stdio   ──> MCP client (the agent)
└─ :PORT   ──> browser tab, opened with `open`
```

Each MCP client spawns its own `relay` process, so each gets its own ephemeral
port. No shared daemon, no port contention. The frontend bundle is `go:embed`ed,
so it stays one binary despite having a JS build step.

<<< USER >>>
Great, but what if we just had everything in typescript?
<<< /USER >>>

## Flow

1. Agent writes a markdown file, calls `relay(path: "...")`.
2. relay copies the file into durable storage, starts serving it, `open`s the URL.
3. The tool call blocks. Nothing is returned yet.
4. Human reads the document in a modal editor (see below). Agent text is
   **read-only** — the editor refuses edits that touch it.
5. Human opens a block of their own and types. It lands in the document flow,
   visually distinct from agent text. They can edit or delete their own blocks;
   they can never touch the agent's.
6. Human accepts.
7. relay writes the accepted document to storage and returns it to the agent.

<<< USER >>>
My idea wasn't for the agent to keep writing markdown. I was sort of hoping for something similar to the artifacts, but that's html, a bit heavy and models are still bad at building svg. Perhaps we can keep markdown in v1
<<< /USER >>>

## The document is a modal editor

Not a rendered HTML page with a keybinding layer bolted on. **CodeMirror 6 +
`@replit/codemirror-vim`** — real vim, not an emulation of the parts someone
remembered. Counts, operators, registers, `.`, macros, `/` search, marks all
come for free and behave correctly.

The document therefore reads as **styled markdown source**, the way it looks in
neovim: `##` is visible, headings are larger, code blocks are tinted. Not
Obsidian-style live preview — hiding markers only on non-cursor lines is real
work and fights the cursor model. It can be added later if the source view
grates.

<<< USER >>>
Works flawlessly. The only problem - I want to comment on any line, including in between words and inside of a work, any place. My commment needs to be highlighted to be distinguishable from original text, the model only recieves a diff in the output.
<<< /USER >>>

### Read-only enforcement

A CM6 transaction filter rejects any change whose range intersects agent text.
Rejected edits flash the affected span rather than silently no-op'ing, so the
human learns the boundary instead of thinking the editor is broken.

<<< USER >>>
What? You will have to explain this.
<<< /USER >>>

### Keymap

Everything vim does, vim does. On top of that:

| key | does |
|---|---|
| `o` / `O` | new USER block below / above the cursor's block → Insert mode |
| `dd`, `cc`, `i`, `a`, … | normal vim, but only inside a USER block |
| `]u` / `[u` | jump to next / previous USER block |
| `:accept`, `ZZ` | accept the document, unblock the agent |
| `:reject`, `ZQ` | see open question below |

<<< USER >>>
drop the BLOCK semantics, I want to edit any part of text.
<<< /USER >>>

An Accept button exists too, for when hands are on the mouse.

## Return value

The full annotated document. Human insertions are fenced:

<<< USER >>>
no, just the diff. the model wrote the original text, so it already knows what is in it
<<< /USER >>>

```
## Findings
The refresh job hits the 100k cap every run, so items expire silently.

<<< USER >>> is this new? it wasn't like this in July <<< /USER >>>

## Proposal
Raise the cap to 250k.

<<< USER >>> no — fix the query instead <<< /USER >>>
```

Not a bare diff: the agent may no longer hold the original in context by the
time the human answers, so context has to travel with the comments.

<<< USER >>>
The original is save to the FS, so they can always pull it, if unsure.
<<< /USER >>>

## Questions are prose

No widgets, no radio buttons, no document schema. The agent asks in ordinary
text; the human answers in an inline block. The human is never constrained to a
set of options the agent thought of.

## Storage

Every relay is durable on disk, sent and accepted versions both:

```
~/.relay/
  <timestamp>-<slug>/
    meta.json      # id, source path, opened/accepted times, cwd
    sent.md        # exactly what the agent showed
    accepted.md    # what came back, with USER blocks
```

## Deliberately out of scope for v1

- Native window / menu-bar app
- Margin comments anchored to a text selection
- Structured JSON return
- Widgets (radio, checkbox, text field)
- Live-preview markdown rendering (marker hiding)
- An index UI browsing past relays

<<< USER >>>
Ok so, when you open the window it needs to be full display hight and about 60% width
Currently the margins are a bit thick, maybe reduce them
For some reason the x - <> buttons oberlap with the window name 
<<< /USER >>>

## Open questions

- **Escape hatch.** Accept is the only exit today. What happens if the human
  closes the tab, or wants to say "stop, this is wrong" rather than annotate?
  A `:reject` that returns an error to the agent is the obvious answer, but it
  was not asked for.
- **Timeout.** Does a blocked tool call wait forever, or give up? Forever is the
  honest default; some MCP clients may not tolerate it.
- **Concurrent relays** from one agent — probably just queue.

<<< USER >>>
If the user closes the window, return that to the agent, is this possible?

Does a blocked tool call wait forever? Yes, it does
Concurrent relays - no, only one at a time
<<< /USER >>>

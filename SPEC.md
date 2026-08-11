# relay — spec

## What it is

An MCP tool that hands a document to a human and blocks until they reply. The
human edits it freely in a vim-modal editor; their edits are highlighted live
against the original, and the agent gets back a **diff**.

The agent must assume the human knows **nothing** about the task except what
relay has shown them.

## Shape

All TypeScript. Two processes, one language:

```
relay (node)  ──stdio──> MCP client (the agent)
     │
     └─spawn─> Electron window ──http──> loopback, for the document + result
```

Node owns stdio so the MCP protocol can never be corrupted by Electron's own
output. Electron owns the window and the keyboard.

## Flow

1. Agent writes a markdown file, calls `relay(path)`.
2. relay copies it to durable storage, opens the window.
3. The tool call blocks — forever, if that is what it takes.
4. The human edits **anywhere**: any line, between words, inside a word. There
   are no protected regions and no comment blocks.
5. Their changes are highlighted live, diffed against the original, so it is
   always obvious which text is theirs and which is the agent's.
6. They accept.
7. relay stores the result and returns **a unified diff** to the agent.

## Editing is unrestricted

Earlier drafts of this spec made agent text read-only and confined the human to
`<<< USER >>>` blocks, enforced by a CodeMirror transaction filter. **That is
gone.** It was the wrong model: it decided in advance where a remark was allowed
to go. Now every character is editable and the diff records what changed.

## Return value

A unified diff, nothing more. The agent wrote the original, so it knows what was
there; and the original is on disk if it needs to re-read it.

```diff
@@ -3,4 +3,4 @@
 The refresh job hits the 100k cap every run.
-Raise the cap to 250k.
+Fix the query instead — raising it just moves the wall.
```

## Questions are prose

No widgets, no schema. The agent asks in ordinary text; the human answers by
editing. They are never boxed into options the agent thought of.

## Window

- Full display height, roughly 60% of display width.
- Narrow margins — the text column should not be squeezed.
- Title bar must not collide with the traffic-light buttons.

## Storage

```
~/.relay/<timestamp>-<slug>/
  meta.json      # id, source path, opened/accepted times, cwd
  sent.md        # exactly what the agent showed
  accepted.md    # what the human accepted
  diff.patch     # what the agent was told
```

## Settled

- **Closing the window is reported to the agent** as such, rather than hanging.
- **A blocked call waits forever.** No timeout.
- **One relay at a time.** Concurrency is not supported.
- **Markdown for v1.** Richer artifact-style documents are the eventual goal,
  but HTML is heavy and models are still poor at SVG, so: markdown now.

## Out of scope for v1

- Rich/HTML documents
- Margin comments anchored to a selection
- Structured JSON return
- Widgets (radio, checkbox, text field)
- Live-preview markdown rendering
- An index UI browsing past relays

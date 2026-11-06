---
name: relay
description: What a relay document can carry — what renders (HTML, inline SVG, markdown tables, checkboxes, mermaid, images), how to ask a question with options, and how to hand the user a command to run in a shell fence. Read before writing a relay document richer than paragraphs. For mermaid diagrams and charts use relay-mermaid; for HTML and SVG, and what the window strips, use relay-html; for images use relay-images; before opening a pull request use relay-pr. Use for "put a table in relay", "ask with options", "checkboxes", "I want to run that command", "does relay render HTML", "make the relay document nicer".
---

# Relay documents

Relay is the only channel to the user; your own harness instructions carry that
rule and the exit codes. This skill is about **what a document may contain**. The
window renders HTML, inline SVG, Mermaid diagrams, markdown tables, checkboxes
and images in place, and it runs shell blocks. Everything the user does in
response comes back as a unified diff.

Write the file, then run `relay <file.md>`.

## What renders

A stretch of the document is replaced by a rendered box when it is one of:

| Written as | Becomes | More in |
| --- | --- | --- |
| An HTML block — a tag on a line of its own | Rendered HTML | relay-html |
| Inline `<svg>…</svg>`, even all on one line | A picture | relay-html |
| A markdown table | A real table | |
| A task list, `- [ ] option` | A checkbox the user ticks with `⌃J` | below |
| A ```` ```mermaid ```` fence | A diagram or a chart, in the window's colours | relay-mermaid |
| `![alt](path.png)` alone on its line | The image | relay-images |

The rendered box is dark (`#24273a` in the default theme), sans-serif, with a thin border. Content
wider than the box scrolls inside it rather than stretching the window.

## Asking a question with options

Give the options as a markdown task list.

```markdown
- [ ] yes
- [ ] no
```

## Asking for a command to be run

The user should never be sent to a terminal. Put the command in a shell fence —
`sh`, `bash`, `zsh`, `shell` or `console` — and they run it where it stands with
`⌃J` (or `:run`), output streaming in below as an ````output```` block that the
diff carries back to you.

```sh
kubectl -n jq get pods | rg creator-admin
```

- **The whole block runs as one script**, so multi-line setups are fine. Leading
  `$ ` / `% ` prompts are stripped.
- **One thing per block.** Output attaches under its own block, and re-running a
  block replaces that block's output rather than stacking.
- **stdin is closed** — anything that would prompt gets EOF instead. No TUIs, no
  `-i`, no interactive login. Those still need the user's own terminal, and
  saying so in prose is the honest move.
- It runs in the **relay's cwd**, which is wherever you launched from. Say which
  directory a command assumes if it is not obvious, or `cd` inside the block.
- Long output is folded, not cut; past ~100 lines it spills to
  `~/.relay/<round>/run-N.log` and the block keeps the head, the tail, and a
  pointer. A non-zero exit appends `[exit N]`.
- Nothing runs on its own. If they never press the key, you get nothing — so
  make it obvious why you want it run.

## Before you launch

- The document stands alone: the user knows only what it says.

---
name: relay
description: Ask the user something, or show them a result, in a relay window instead of the terminal — a markdown document they edit and accept, whose diff comes back to you. Use when you need an answer, a decision, a review of a plan or a diff, or want the user to run a command; and for anything richer than a paragraph — tables, mermaid diagrams, inline SVG, task-list choices.
---

# Talking to the user through relay

`relay <file.md>` puts a markdown document in a window on the user's screen. They
edit it anywhere and accept it. relay then prints a unified diff of their edits
and exits.

## How to send one

1. Write the document to a file in your scratch or temp directory.
2. Run it with Bash and **`run_in_background: true`**:

   ```
   relay <file.md>
   ```

   It blocks until the user answers, for as long as that takes. A foreground run
   hits the command timeout first.
3. **End your turn.** Do nothing else while the window is open. You are notified
   when the command exits.
4. Read the command's output. Your next step comes from the diff.

## What comes back

| Exit | Meaning | stdout |
|---|---|---|
| 0 | Accepted | The unified diff of their edits, or `no changes — the human accepted the document as written` |
| 1 | Closed without a reply | Empty. Do not resend the same document; ask in the terminal or wait. |
| 2 | Bad usage, or the file could not be read | Empty; stderr says why |

Lines starting with `+` are what the user wrote. Lines starting with `-` are
what they deleted from your text. A deletion is an answer too.

## Writing the document

- **Lead with the answer or the result.** Put the question where the user writes
  the reply, and leave an empty line under it.
- **Number the questions.** One question per item, with `**Answer:**` and an empty
  line under each.
- **Offer choices as a task list.** `- [ ] Yes`, `- [ ] No`. The user ticks one
  with `⌃J`, and the tick comes back as `[x]` in the diff.
- **Tables, HTML, inline SVG and ```` ```mermaid ```` fences render as pictures.**
  Use them for designs, comparisons and diagrams.
- **Images:** `![](shot.png)` next to the document, or an `https:` URL.
- **A ```` ```diff ```` fence is a review.** Lines the user adds without a diff
  marker come back as comments with `file:line`. If the patch itself holds a
  ```` ``` ```` fence, open the diff with more backticks than any fence inside it,
  or relay refuses the document with exit 2.

## Commands for the user to run

Put a command the user should run, for example one you are not allowed to run,
in a `sh`, `bash`, `zsh`, `shell` or `console` fence. The user runs it in the
window with `⌃J`. The output appears under the fence as an ```` ````output ````
block, so it comes back to you in the diff.

A `⌃J` run has no input: a command that asks a question gets end-of-file. For a
command that needs the user to type, such as a login or a prompt, tell them to
run it with `⌃⇧J`. That runs it in a live terminal under the fence, and its
final screen comes back to you as the output block.

- The command runs in the directory you ran relay from.
- Write it so it can run as is: no placeholders, nothing the user has to fill in.
- Do not wrap it in `echo` or explain it inside the fence. Explain it above.

## More than one session

Every relay goes through one window. If another agent's document is up, yours
waits its turn and opens when that one is answered. Nothing for you to do: the
command just takes longer to return.

`relay --priority` is the user's, not yours. Never run it.

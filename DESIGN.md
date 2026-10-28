# relay — design

Relay is a window that shows you a document from an agent and waits for your reply. It uses podium's language: the same palette, the same role names and the same principles. It has its own parts, because it is an editor and not a list. This file holds the decisions and the reasons for them. `src/palette.ts` and `ui/design.css` hold the values. The CSS carries no comments.

Relay keeps its own copy of the palette and roles. It does not load podium's stylesheet, because relay also runs without podium. The two can drift apart in their parts, but not in their colours.

## Principles

Relay follows podium's principles: **one colour, one claim**; **nearer is lighter**; **ground, not edges**; **named once**; **quiet by default**. Relay adds three of its own:

**What you wrote is the loudest thing on screen.** Your edits are white, the one colour brighter than `--title`. That way you can always tell your words from the agent's.

**Added is green, removed is red, everywhere.** This covers your edits, a diff, a ticked box and the mark on the accept screen. Inside relay these are the claims of green and red. podium's *working* keeps green for a running command, because a running command is adding output.

**The frame is monospace, and what the agent rendered is not.** The footer, cards and run status are monospace like podium. An HTML block the agent wrote is set in sans-serif, because it is a page to read, not relay's frame.

## Colour

The palette is Catppuccin Macchiato. The names are Catppuccin's own.

### Grounds, deepest to nearest

| Name | Hex | Where | Token |
| --- | --- | --- | --- |
| crust | `#181926` | the document; the window before the page loads | `--deep` |
| mantle | `#1e2030` | the footer, the standalone header, the diff bar, a run's status line, code, the search and vim panels | `--pane` |
| base | `#24273a` | a card (Help, run choice), a rendered HTML box, the live terminal | `--surface` |
| surface0 | `#363a4f` | hover, the keyboard's row, and every line | `--hover`, `--line` |
| surface2 | `#5b6078` | a mermaid node's line, the terminal's selection | |

The scrim behind a card is crust at 62%. The accept screen is crust at 94%.

These replace relay's seven grounds and two line colours: `#16161e`, `#1a1b26`, `#1b1c29`, `#20222f`, `#232638`, `#303851`, `#292e42`, `#2a2e3f` and `#414968`.

### Text, loudest to quietest

| Name | Hex | Role | Token |
| --- | --- | --- | --- |
| white | `#ffffff` | what you wrote: an edit, a comment | `--yours` |
| text | `#cad3f5` | the document; text; bold text, a card's subject, a table's head | `--fg`, `--title` |
| subtext0 | `#a5adcb` | a second voice: what a key does in Help, the dim line on a hovered row | `--said` |
| overlay1 | `#8087a2` | dim: a quote, a URL, a time, a run's id, a fold, a key line's verb, a diff's note | `--dim` |
| overlay0 | `#6e738d` | faint: a line number, a rule, struck text, a diff's `+` and `-`, a code comment | `--faint` |

These replace relay's three dims: `#565f89`, `#7a85b8` and `#9aa5ce`.

### One claim each

| Name | Hex | Claim in relay | Token |
| --- | --- | --- | --- |
| sky | `#91d7e3` | a thing you could do: Accept, a focus ring, a card's label, a choice's letter, a fold on hover, a `<summary>` | `--accent` |
| blue | `#8aadf4` | a reference: a link, a file link, a diff's file | `--ref` |
| green | `#a6da95` | added: your edits, a diff's added lines, a ticked box, the accept mark; working: insert mode, a running command | `--added` |
| red | `#ed8796` | removed: a deletion, a diff's removed lines; failed: a run that failed, the error mark; the Stop button | `--removed` |
| yellow | `#eed49f` | waiting: a queued run | `--idle` |
| peach | `#f5a97f` | read this before you act: your comment, visual mode, a stopped or skipped run, a blocked HTML block, a draft that was not saved | `--needs` |
| rosewater | `#f4dbd6` | the cursor | `--caret` |

The tokens match podium's where the claim is the same. `--added`, `--removed`, `--yours` and `--caret` are relay's own. `--working` is kept as another name for green, and `--danger` for red.

Syntax colours are the one exception to one colour, one claim. They are the same as in podium's settings editor: mauve for a keyword, green for a string, peach for a number, blue for a function, sky for a built-in variable, teal for a type, red for a tag, peach for an attribute, `--dim` for punctuation and faint italic for a comment.

### Washes

Same as podium: three strengths and no others.

| Strength | Used for |
| --- | --- |
| 12% as ground | a whole line: an added or removed line, a comment line, a diff's file header, the file you are on in the picker, a trouble line |
| 18% as ground | a word inside a line: text you typed, a changed word in a diff; hover over something already washed |
| 35% as a line | the strike through deleted text, the outline of a button, the edge of a trouble line |

A line that carries a claim also has a 2px inset edge on its left in the claim's colour. Washes are written as `color-mix(in srgb, var(--claim) 12%, transparent)`.

## Type

The frame uses one family: `ui-monospace, SFMono-Regular, Menlo, monospace`. Rendered HTML uses `ui-sans-serif, -apple-system, system-ui, sans-serif`. Weights are 400, 700 for a heading and bold text in the document, and 600 for a subject, a label, the mode word and a run's phase.

| Size | Role |
| --- | --- |
| 10px | the label |
| 11px | small: a run's status line, a key line, the picker's heading and hints, a card's note |
| 13px | the frame: the footer, a card, the live terminal, the diff bar; small text inside the document (a fold, *N more deleted*) |
| 14px | rendered HTML |
| 15px | the document |
| 1.15em, 1.35em, 1.7em | headings 3, 2 and 1 in the document |
| 22px and 56px | the title and the mark on the accept screen |

The document's line height is 1.7, for reading. Everything else is 1.5. These replace 12px, 18px and 19px.

## Space and shape

The gutter is 16px, in the footer and on a card. The document is at most `96ch + 4rem` wide and centred. Its lines have 12px on each side, and it leaves 45vh empty below the last line.

| Radius | What |
| --- | --- |
| 2px | a mark inside text: a washed word, inline code |
| 4px | a control: a button, a checkbox, a field |
| 6px | a box: rendered HTML, the live terminal, a row in the picker or a card, a trouble line |
| 10px | a card |

These replace 3px, 7px, 12px and the pill. Lines are 1px surface0. A card's shadow is `0 24px 64px rgba(0, 0, 0, .55)`, as in podium. The focus ring is 1px sky, 2px inside the edge, everywhere.

## Parts

**The window** is crust from its first frame. Standalone, it has a 44px mantle header: the file's name in `--title` and *the agent is waiting* in dim. Inside podium it has no header.

**The document** is 15px monospace on crust in `--fg`, with line numbers in faint. The cursor is rosewater: a 2px bar, or a block in normal mode. A selection is a 45% blue wash, so it shows through inline code and over a code block. The current line is not marked.

- Headings are bold (700): blue at 1.7em and 1.35em, sky at 1.15em and below.
- Bold is `--title` at 700. Italic is `--fg`. Struck text is faint.
- A link is sky and underlined. A bare URL is dim.
- A quote is dim and italic.
- A list item is mauve. A rule is faint.
- Inline code is green on a 12% blue wash, radius 2. The wash lets a selection show through. A code block's lines are on mantle, edge to edge. The mantle is painted under the selection layer, as a pseudo-element of the line, so a selection shows over it.

**Your edits.** Text you typed is `--yours` on an 18% green wash, radius 2. A line you added is `--yours` on a 12% green wash with a 2px green edge. A line you changed has only the edge. Deleted text is red, struck through by a 35% red line, on a 12% red wash. A deleted block has a 2px red edge. *N more deleted* is dim at 13px.

**Your comment** is `--yours` on a 12% peach wash with a 2px peach edge.

**A checkbox** is 1em square, radius 4, with a faint line. Ticked, it is filled green with a crust tick.

**A fold** is dim at 13px. On hover it turns sky.

**The footer** is mantle with a surface0 line above it, 13px, with the 16px gutter. From the left:

- the mode word: *NORMAL* in dim, *INSERT* in green, *VISUAL* in peach;
- what changed: *unchanged* in dim, or `+N` in green and `−N` in red;
- the draft warning, if there is one: *draft not saved* in peach, with *retry* as a text action;
- the context action, as a key-line entry: the key in `--fg`, then the verb in dim (*i edit*, *⌃J run*, *gx open link*);
- the note, in `--fg`.

At the right are the queue (*2 waiting*, dim, no box), *help* as a soft button, and Accept.

**Accept** is the one filled button: crust text on sky, weight 600, radius 4, padded 3px 9px. The key follows in the same colour at weight 400: *accept ⌃X*. Hover is sky at 85%. In a read-only round, *close :q* is the filled button instead.

**A button** is podium's: text in its claim's colour, sky if it has no claim, a 35% line of the same colour, radius 4, padded 3px 9px. Hover is a 12% wash. A soft button is dim with a surface0 line: *help*, the picker toggle. Stop is a red button.

**A card** is podium's card: base with a surface0 line, radius 10, the card shadow, 13px, `min(560px, 88%)` wide, centred, over the scrim. It has a label first, the subject in `--title` at weight 600, and a key line last.

- **Help** is labelled *KEYS*, with the subject *edit and reply* (or *read this round*). Each section is headed by a dim label. Each entry is the key in `--fg`, then what it does in `--said`. The note at the bottom is dim at 11px. The key line reads *esc close*.
- **The diagram menu** opens where a diagram is right-clicked. It is a box on base with a line edge, no label and no subject: two rows, **[S]ave diagram as PNG…** and **[C]opy diagram as PNG**, each with its letter in sky.
- **The run choice** is labelled *ANOTHER COMMAND IS RUNNING*, with the subject *run this command*. The command follows in dim at 11px. There are two rows, **[Q]ueue** and **[P]arallel**, each with its letter in sky and a dim second line. The keyboard's row is on surface0. The key line reads *↑↓ move ↵ run esc cancel*.

**A key line** is podium's: 11px, the key bare in `--fg`, then the verb in dim, entries `.75rem` apart.

**The accept screen** covers the window with crust at 94%. It shows a 56px mark (green when the reply is sent, red on an error), a 22px title in `--title`, and a 13px note in dim.

**The diff.**

- An added line is on a 12% green wash; a removed line on a 12% red wash.
- A changed word is on an 18% wash of the same colour, radius 2.
- The `+` and `-` are faint.
- A file's header is blue at weight 600 on a 12% blue wash.
- A hunk starts with a surface0 line.
- A note is dim and italic.

**The diff bar** sits above the document: mantle, with a surface0 line below it, 13px. The current file is blue and is a button without a box. The picker toggle is a soft button.

**The picker** opens under the bar. Its heading and hints are dim at 11px. Its files are rows: radius 6, padded 5px 8px, with the keyboard's row on surface0. The file you are on has a 12% blue wash with a 2px blue edge. A file's counts are `+N` in green and `−N` in red.

**A run's status line** sits under its shell block: mantle, 11px monospace, with a 2px left edge in the run's colour. The phase word is in the same colour, at weight 600:

- running: green
- queued: yellow
- stopped or skipped: peach
- failed: red
- succeeded: dim, with a surface0 edge

The run's id, time and *edited* are dim. Stop is a red button at the right.

**The live terminal** is a box under its block: base, a surface0 line, radius 6, 13px monospace. It has a 2px left edge in the run's colour. When it has the keys, its line turns sky. Its colours are Ghostty's Catppuccin Macchiato, the same as podium's terminal pane: base background, text foreground, rosewater cursor, surface2 selection.

**Rendered HTML** is a box: base, a surface0 line, radius 6, padded 9px 10px, 14px sans-serif, line height 1.5.

- A table has surface0 lines. Its head row is `--title` at weight 600, with no ground of its own.
- A link is blue.
- Code is monospace in `--fg` on mantle.
- A `<summary>` is sky.
- An image or SVG is never wider than the box.
- A blocked block says why in peach, as podium's warning does.
- A block that failed to render shows a trouble line: peach on a 12% peach wash, with a 35% peach edge, radius 6.

**A mermaid diagram** sits on base. Its nodes are base with a surface2 line and `--fg` text. Its edges are dim. Its notes are mantle with a surface0 line.

**The search and vim panels** are mantle with a surface0 line above them. A field in them has a surface0 line, radius 4, mantle ground, and `--fg` text.

## Words on screen

As in podium: short, lower case, no exclamation marks, no *error:*. A key line names the key and then the verb. Keys are written as glyphs, ⌘ ⇧ ⌃ ↵ ←→, with *esc* in letters. A mode word is the one thing in capitals, as in Vim.

## In code

`src/palette.ts` holds the 26 Catppuccin colours, named as Catppuccin names them, as Macchiato, plus relay's own `white` for the user's edits. `src/theme.ts` picks the palette for a window. `src/page.ts` writes it into the page as CSS variables, inline, and links `relay.css`. `ui/design.css` holds the roles and the parts, and is bundled into `relay.css`. `ui/src/theme.ts` uses only the roles. `ui/src/diagram.ts` and `ui/src/tty.ts` cannot use CSS, so they read the variables from the page when they draw (`ui/src/colours.ts`). `src/shell.ts` paints the window with the theme's crust. No other file names a hex.

### Themes

A theme is a YAML file in `~/.relay/themes/`, named `<name>.yaml`. It lists colours by their Catppuccin names, with values like `"#1e1e2e"`, and may have a `name:`. A colour left out is Macchiato's. The roles never change; a theme only changes the values. `white` is not in a theme.

`~/.relay/config.json` picks the theme: `{ "theme": "mocha" }` uses `~/.relay/themes/mocha.yaml`. No file or no key means Macchiato. When relay starts it writes `macchiato.yaml` into the folder if there is none, never over an existing one, so there is a file to copy. Only Macchiato ships.

The theme is read each time a window opens, so a saved change shows in the next window. If the theme cannot be used (no such file, YAML that does not parse, an unknown colour name, a value that is not `#rrggbb`, a broken `config.json`), relay uses Macchiato and says why in the footer, in `--needs`, for example `theme mocha not found — using macchiato`. relay does not read podium's theme.

The parts in `ui/design.css` sit inside `@scope (:root) to (.cm-relay-render, svg)`. What the agent rendered and what mermaid draws are not relay's frame, so relay's part classes do not reach into them. Without the scope, a mermaid node label took `.label`, came out in capitals, and was clipped.

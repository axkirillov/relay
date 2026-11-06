---
name: relay-html
description: How to draw with HTML, CSS and inline SVG in a relay document — what the window strips, the palette, how wide to go, styling rules, and recipes for a flow, a proportion and a geometric picture. Read before putting an HTML block or an SVG picture in relay. Use for "visualise this", "draw it in HTML", "an SVG", "bars", "a flow".
---

# HTML and SVG in relay

The window is about 60% of the display width, so keep a picture under ~700px of
real content.

## What the window strips

The window loads no code of yours and makes no requests except for pictures.
Stripped on the way in: `script`, `iframe`, `object`, `embed`, `base`, `link`,
`meta`, `form`, `input`, `button`, `textarea`, `select`, `audio`, `video`, every
`on*` attribute, `srcdoc`, and `javascript:` / `data:text/html` URLs.

Markdown is not processed inside an HTML block: `**bold**` in a `<div>` stays
literal asterisks. Use `<strong>`/`<em>`.

## Tags must balance

A block that leaves a tag open (or closes one it never opened) stays as source —
half a tag would render as an empty box. Blank lines *inside* a balanced block
are fine: markdown cuts the block at a blank line and relay welds the pieces back
together. So one balanced outer element gives one box, however many blank lines
are inside it.

## Styling

- **No external stylesheets or webfonts.** Style with `style=` attributes.
- `<style>` blocks do survive, but avoid them: their CSS applies to the whole
  window rather than your box, and a `<style>` block un-renders the moment the
  user's caret enters it — taking your diagram's styling with it while the
  diagram itself stays rendered and looks broken. Inline styles cannot detach.
- **Never wrap a shell fence in HTML.** The fence gets swallowed into the
  rendered block and stops being runnable.

## The window's palette

Match it, or the diagram reads as a foreign object. The window takes its colours
from a theme, Catppuccin Macchiato unless the user picked another. Each colour
is a CSS variable on the page, so `color:var(--blue)` in a style, or
`fill="var(--blue)"` on an SVG shape, follows whatever theme is on. The hex is Macchiato's, for when a variable will
not do.

| | Variable | Macchiato |
| --- | --- | --- |
| box background | `--base` | `#24273a` |
| text | `--text` | `#cad3f5` |
| borders | `--surface0` | `#363a4f` |
| dim (arrows, labels) | `--overlay1` | `#8087a2` |
| blue / sky | `--blue` / `--sky` | `#8aadf4` / `#91d7e3` |
| green (good) | `--green` | `#a6da95` |
| peach (warn) | `--peach` | `#f5a97f` |
| red (bad) | `--red` | `#ed8796` |
| mauve | `--mauve` | `#c6a0f6` |
| emphasis | `--white` | `#ffffff` |

## Recipes

Reach for Mermaid (relay-mermaid) when the picture is nodes and edges — classes,
a flow, who calls whom — and for a chart from numbers. Reach for HTML/CSS for anything that is boxes-and-labels; it reflows
and is far less to get wrong. Reach for SVG when the picture has geometry —
arrows, proportion, position.

**A rendered box is HTML, so runs of spaces collapse.** A tree or a column drawn
with leading spaces inside `<div>`s loses every level of its indentation and
lands flush left — `.cm-relay-box` sets no `white-space`, so the default
`normal` applies. Structure goes in one `<pre>`, where the whitespace *is* the
layout — and which markdown ends at `</pre>` rather than at a blank line, so it
cannot be split — or in CSS with `padding-left`. Never in the characters.

**Sizes in `em`, leading near the document's.** `rem` keys off the page's 16px
root and not your block's font-size, so `1.4rem` indents on 12.5px text step out
three characters at a time and the picture sprawls; `em` scales with the text.
Leading is the other half: relay's own prose runs at `15px/1.7`
(`.cm-scroller`), so a block at 1.3 reads squished beside it and ~1.8 sits with
it. Match the page instead of picking a number.

**Look at it before you send it.** Both of the above are invisible in the source
and obvious on screen, and each guess costs a round trip. Rebuild the box from
`ui/src/theme.ts` into a scratch HTML file, render variants side by side, and
read the PNG:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=900,400 --screenshot=out.png "file://$PWD/harness.html"
```

**A flow, in HTML.** One balanced outer element, so it is one box:

```html
<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;font-size:13px">
  <div style="padding:.4rem .7rem;border:1px solid #8aadf4;border-radius:4px">scraper</div>
  <span style="color:#8087a2">→</span>
  <div style="padding:.4rem .7rem;border:1px solid #8aadf4;border-radius:4px">BFF</div>
  <span style="color:#ed8796">→ 20.6s</span>
  <div style="padding:.4rem .7rem;border:1px solid #ed8796;border-radius:4px">creator-admin</div>
</div>
```

**Proportion, in HTML.** Bars beat numbers for "how much of what":

```html
<div style="font-size:13px">
  <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.3rem">
    <span style="width:9rem">unlabelled</span>
    <span style="flex:1;background:#363a4f;height:14px;border-radius:2px">
      <span style="display:block;width:70.1%;height:100%;background:#f5a97f;border-radius:2px"></span>
    </span>
    <span style="color:#f5a97f">70.1%</span>
  </div>
</div>
```

**Geometry, in SVG.** `viewBox` plus a `marker` for arrowheads; the theme already
caps it at the box width:

```html
<svg viewBox="0 0 320 60" width="320" style="max-width:100%">
  <defs>
    <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#8087a2"/>
    </marker>
  </defs>
  <rect x="1" y="18" width="90" height="26" rx="4" fill="none" stroke="#8aadf4"/>
  <text x="46" y="35" fill="#cad3f5" font-size="12" text-anchor="middle">queue</text>
  <line x1="95" y1="31" x2="135" y2="31" stroke="#8087a2" marker-end="url(#a)"/>
  <rect x="139" y="18" width="90" height="26" rx="4" fill="none" stroke="#ed8796"/>
  <text x="184" y="35" fill="#cad3f5" font-size="12" text-anchor="middle">worker</text>
</svg>
```

Prefer a markdown table to a hand-built HTML one — it renders as a real table,
and it stays editable as text when the user wants to answer inside it.

Draw only when the picture carries something prose cannot: a topology, a
proportion, a before/after. A diagram of three sentences is three sentences with
extra steps.

## Before you launch

- No script, no interactive control.
- The whole picture in one balanced outer element.
- No structure carried by runs of spaces — `<pre>` or `padding-left`, never both
  a `<div>` and hopeful indentation.
- Sizes in `em`, leading near the document's 1.7 — and the picture rendered and
  looked at, not imagined.
- No `<style>` block; inline styles only.
- Colours from the palette above; nothing assuming a light background.
- Commands in shell fences, never inside HTML.

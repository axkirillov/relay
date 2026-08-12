import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const bg = "#16161e";
const panel = "#1a1b26";
const fg = "#c0caf5";
const dim = "#565f89";
const line = "#2a2e3f";
const blue = "#7aa2f7";
const cyan = "#7dcfff";
const green = "#9ece6a";
const orange = "#ff9e64";
const magenta = "#bb9af7";
const red = "#f7768e";
const human = "#ffffff";
const addWash = "rgba(158, 206, 106, 0.22)";
const delWash = "rgba(247, 118, 142, 0.12)";

export const theme = EditorView.theme(
  {
    "&": { color: fg, backgroundColor: bg, height: "100%", fontSize: "15px" },
    // The measure is centred here rather than on .cm-content, because the line
    // number gutter is a sibling pinned to the left edge of the scroller: centre
    // the content and the numbers strand themselves across the window from it.
    ".cm-scroller": {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      lineHeight: "1.7",
      overflowX: "hidden",
      // width as well as maxWidth: auto side margins turn off a flex item's
      // stretch, and without a width of its own the scroller would shrink to
      // whatever the longest line happens to be and shift as the human types.
      width: "100%",
      maxWidth: "calc(96ch + 4rem)",
      margin: "0 auto",
    },
    ".cm-content": {
      padding: "1.25rem 0 45vh 0",
      caretColor: orange,
    },
    ".cm-line": { padding: "0 0.75rem" },

    // Numbers so the human can point at a line when they write back.
    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRight: "none",
      color: dim,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 0.75rem 0 0.75rem",
      minWidth: "3ch",
    },

    "&.cm-focused .cm-cursor": { borderLeftColor: orange, borderLeftWidth: "2px" },
    "&.cm-focused .cm-fat-cursor": { background: orange, outline: "none" },
    "&:not(.cm-focused) .cm-fat-cursor": { background: "none", outline: `1px solid ${orange}` },
    ".cm-fat-cursor-mark": { background: orange },

    // Matching CodeMirror's own selector depth on purpose: its dark base theme
    // styles this exact path with `#233`, which is invisible here, and a
    // shorter selector loses to it.
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      {
        background: "#3d59a1",
      },
    ".cm-activeLine": { backgroundColor: "transparent" },

    // The live diff. The human's text is white on green whatever markdown
    // thinks the line is, so a remark dropped into a list does not come out
    // looking like the agent's list.
    ".cm-relay-add, .cm-relay-add span, .cm-relay-add-line, .cm-relay-add-line span": {
      color: `${human} !important`,
      fontStyle: "normal !important",
    },
    ".cm-relay-add": {
      backgroundColor: addWash,
      borderRadius: "2px",
    },
    // A line that is entirely theirs lights up end to end rather than word by
    // word — the same distinction git draws.
    ".cm-relay-add-line": {
      backgroundColor: addWash,
      boxShadow: `inset 2px 0 0 ${green}`,
    },
    ".cm-relay-touched": { boxShadow: `inset 2px 0 0 ${green}` },

    ".cm-relay-del, .cm-relay-del span": { color: `${red} !important` },
    ".cm-relay-del": {
      backgroundColor: delWash,
      textDecoration: "line-through",
      textDecorationColor: "rgba(247, 118, 142, 0.55)",
      borderRadius: "2px",
    },
    // Deleted lines stand in the gap they left, aligned with the real lines
    // around them.
    ".cm-relay-del-block": {
      backgroundColor: delWash,
      boxShadow: `inset 2px 0 0 ${red}`,
    },
    ".cm-relay-del-line": {
      padding: "0 0.75rem",
      color: red,
      textDecoration: "line-through",
      textDecorationColor: "rgba(247, 118, 142, 0.55)",
      whiteSpace: "pre-wrap",
    },
    ".cm-relay-del-more": {
      padding: "0 0.75rem",
      color: dim,
      fontSize: "0.85em",
    },

    // Rendered HTML. Deliberately not monospace: the change of typeface is how
    // you can tell at a glance that a block is standing rendered rather than as
    // the source you can edit.
    // Padding, never margin — see the comment on the widget in render.ts.
    ".cm-relay-render": { padding: "0.4rem 0.75rem" },
    ".cm-relay-box": {
      padding: "0.7rem 0.9rem",
      background: "#1b1c29",
      border: `1px solid ${line}`,
      borderRadius: "4px",
      overflowX: "auto",
      font: '14px/1.55 ui-sans-serif, -apple-system, system-ui, sans-serif',
      color: fg,
    },
    ".cm-relay-box > :first-child": { marginTop: 0 },
    ".cm-relay-box > :last-child": { marginBottom: 0 },
    ".cm-relay-render table": { borderCollapse: "collapse" },
    ".cm-relay-render th, .cm-relay-render td": {
      border: `1px solid ${line}`,
      padding: "0.3rem 0.7rem",
      textAlign: "left",
      verticalAlign: "top",
    },
    ".cm-relay-render th": { color: human, fontWeight: "700", backgroundColor: "#20222f" },
    ".cm-relay-render img, .cm-relay-render svg": { maxWidth: "100%", height: "auto" },
    ".cm-relay-render a": { color: cyan },
    ".cm-relay-render code": { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', color: green },
    ".cm-relay-render summary": { cursor: "pointer", color: cyan },
    ".cm-relay-blocked": { color: orange, fontStyle: "italic" },

    ".cm-panels": { backgroundColor: panel, color: fg },
    ".cm-panel.cm-search input, .cm-panel.cm-search button": {
      backgroundColor: bg,
      color: fg,
      border: `1px solid ${line}`,
    },
    ".cm-vim-panel": {
      backgroundColor: panel,
      color: fg,
      padding: "4px 1rem",
      borderTop: `1px solid ${line}`,
    },
    ".cm-vim-panel input": { color: fg, fontFamily: "inherit" },
  },
  { dark: true },
);

// Markdown is styled rather than merely monospaced: headings carry real weight
// and size, so the document reads as a document.
export const markdownHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading1, color: blue, fontWeight: "700", fontSize: "1.7em", lineHeight: "1.9" },
    { tag: t.heading2, color: blue, fontWeight: "700", fontSize: "1.35em", lineHeight: "2" },
    { tag: t.heading3, color: cyan, fontWeight: "700", fontSize: "1.15em" },
    { tag: [t.heading4, t.heading5, t.heading6], color: cyan, fontWeight: "700" },
    { tag: t.strong, color: "#e6eaff", fontWeight: "700" },
    { tag: t.emphasis, color: fg, fontStyle: "italic" },
    { tag: t.strikethrough, color: dim, textDecoration: "line-through" },
    { tag: t.link, color: cyan, textDecoration: "underline" },
    { tag: t.url, color: dim },
    { tag: [t.monospace], color: green, backgroundColor: "#1e2030" },
    { tag: t.quote, color: dim, fontStyle: "italic" },
    { tag: t.list, color: magenta },
    { tag: t.contentSeparator, color: dim },
    { tag: t.processingInstruction, color: dim },
    { tag: t.labelName, color: orange },
  ]),
);

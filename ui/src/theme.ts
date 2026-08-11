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
const userTint = "#1f2335";
const userBar = "#e0af68";

export const theme = EditorView.theme(
  {
    "&": {
      color: fg,
      backgroundColor: bg,
      height: "100%",
      fontSize: "15px",
    },
    ".cm-scroller": {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      lineHeight: "1.7",
      overflowX: "hidden",
    },
    // The document sits in a centred column rather than hugging the left edge.
    ".cm-content": {
      maxWidth: "82ch",
      margin: "0 auto",
      padding: "3rem 0 60vh 0",
      caretColor: orange,
    },
    ".cm-line": { padding: "0 1.5rem" },

    "&.cm-focused .cm-cursor": {
      borderLeftColor: orange,
      borderLeftWidth: "2px",
    },
    // Block cursor for normal mode, from the vim extension.
    "&.cm-focused .cm-fat-cursor": {
      background: orange,
      outline: "none",
    },
    "&:not(.cm-focused) .cm-fat-cursor": {
      background: "none",
      outline: `1px solid ${orange}`,
    },
    ".cm-fat-cursor-mark": { background: orange },

    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "#283457",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },

    // A USER block: tinted, with a bar down the left so it reads as an
    // insertion into the agent's document rather than part of it.
    ".cm-relay-user": {
      backgroundColor: userTint,
      boxShadow: `inset 3px 0 0 ${userBar}`,
    },
    ".cm-relay-first": { borderTop: `1px solid ${line}` },
    ".cm-relay-last": { borderBottom: `1px solid ${line}` },
    ".cm-relay-marker": {
      color: dim,
      fontSize: "11px",
      letterSpacing: "0.08em",
    },

    // Flash shown when an edit is refused because it touched agent text.
    "&.cm-relay-refused .cm-content": {
      animation: "cm-relay-shake 160ms ease-in-out",
    },
    "@keyframes cm-relay-shake": {
      "0%, 100%": { transform: "translateX(0)" },
      "25%": { transform: "translateX(-3px)" },
      "75%": { transform: "translateX(3px)" },
    },

    ".cm-panels": { backgroundColor: panel, color: fg },
    ".cm-panel.cm-search input, .cm-panel.cm-search button": {
      backgroundColor: bg,
      color: fg,
      border: `1px solid ${line}`,
    },
    // The vim command line at the bottom.
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

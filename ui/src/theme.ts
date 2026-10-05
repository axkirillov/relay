import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const bg = "#16161e";
const panel = "#1a1b26";
const fg = "#c0caf5";
const dim = "#565f89";
const muted = "#7a85b8";
const line = "#2a2e3f";
const blue = "#7aa2f7";
const cyan = "#7dcfff";
const teal = "#2ac3de";
const green = "#9ece6a";
const orange = "#ff9e64";
const magenta = "#bb9af7";
const red = "#f7768e";
const punct = "#9aa5ce";
const human = "#ffffff";
const addWash = "rgba(158, 206, 106, 0.22)";
const delWash = "rgba(247, 118, 142, 0.12)";
const yellow = "#e0af68";
const diffAddWash = "rgba(158, 206, 106, 0.13)";
const diffDelWash = "rgba(247, 118, 142, 0.13)";
const diffFileWash = "rgba(122, 162, 247, 0.2)";
const commentWash = "rgba(224, 175, 104, 0.22)";
const codeWash = "rgba(122, 162, 247, 0.11)";

const size = 15;
const leading = 1.7;

export const theme = EditorView.theme(
  {
    "&": { color: fg, backgroundColor: bg, height: "100%", fontSize: `${size}px` },
    ".cm-scroller": {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      lineHeight: `${leading}`,
      overflowX: "hidden",
      width: "100%",
      maxWidth: "calc(96ch + 4rem)",
      margin: "0 auto",
    },
    ".cm-content": {
      padding: "1.25rem 0 45vh 0",
      caretColor: orange,
    },
    ".cm-line": { padding: "0 0.75rem" },

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

    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      {
        background: "#3d59a1",
      },
    ".cm-activeLine": { backgroundColor: "transparent" },

    ".cm-relay-add, .cm-relay-add span, .cm-relay-add-line, .cm-relay-add-line span": {
      color: `${human} !important`,
      fontStyle: "normal !important",
    },
    ".cm-relay-add": {
      backgroundColor: addWash,
      borderRadius: "2px",
    },
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
      color: muted,
      fontSize: "0.85em",
    },

    ".cm-run-status": {
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "0.35rem 0.65rem",
      padding: "0.3rem 0.75rem",
      backgroundColor: panel,
      borderLeft: `2px solid ${line}`,
      font: '12px/1.5 ui-sans-serif, -apple-system, system-ui, sans-serif',
      color: punct,
    },
    ".cm-run-id, .cm-run-time, .cm-run-edited": { color: punct },
    ".cm-run-phase": { fontWeight: "600" },
    ".cm-run-running": { borderLeftColor: cyan },
    ".cm-run-running .cm-run-phase": { color: cyan },
    ".cm-run-queued .cm-run-phase": { color: yellow },
    ".cm-run-succeeded .cm-run-phase": { color: green },
    ".cm-run-failed .cm-run-phase": { color: red },
    ".cm-run-stopped .cm-run-phase, .cm-run-skipped .cm-run-phase": { color: orange },
    ".cm-run-status button": {
      marginLeft: "auto",
      font: "inherit",
      padding: "1px 8px",
      color: fg,
      background: "transparent",
      border: `1px solid ${dim}`,
      borderRadius: "3px",
      cursor: "pointer",
    },
    ".cm-run-status button[hidden]": { display: "none" },
    ".cm-run-status button:hover": { background: "#292e42" },
    ".cm-run-status button:focus-visible": { outline: `2px solid ${yellow}`, outlineOffset: "2px" },

    ".cm-relay-fence": { backgroundColor: codeWash },
    ".cm-relay-code": { color: green, backgroundColor: codeWash },
    ".cm-relay-fence .cm-relay-code": { backgroundColor: "transparent" },

    ".cm-relay-diff-add": { backgroundColor: diffAddWash },
    ".cm-relay-diff-del": { backgroundColor: diffDelWash },
    ".cm-relay-diff-add-word": {
      backgroundColor: "rgba(158, 206, 106, 0.35)",
      boxShadow: `inset 0 -1px 0 ${green}`,
      borderRadius: "2px",
    },
    ".cm-relay-diff-del-word": {
      backgroundColor: "rgba(247, 118, 142, 0.35)",
      boxShadow: `inset 0 -1px 0 ${red}`,
      borderRadius: "2px",
    },
    ".cm-relay-diff-mark": { color: dim },
    ".cm-relay-diff-file, .cm-relay-diff-file span": { color: `${cyan} !important` },
    ".cm-relay-diff-file": { backgroundColor: diffFileWash, fontWeight: "700" },
    ".cm-relay-diff-navigation": {
      flexShrink: "0",
      boxSizing: "border-box",
      width: "100%",
      maxWidth: "calc(96ch + 4rem)",
      margin: "0 auto",
      borderBottom: `1px solid ${line}`,
      backgroundColor: panel,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    },
    ".cm-relay-diff-navigation [hidden], .cm-relay-diff-navigation[hidden]": { display: "none" },
    ".cm-relay-diff-bar": { display: "flex", alignItems: "center" },
    ".cm-relay-diff-current": {
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
      flex: "1",
      minWidth: "0",
      order: "0",
      padding: "0.4rem 0.75rem",
      border: "none",
      background: "transparent",
      color: cyan,
      font: "inherit",
      textAlign: "left",
      cursor: "pointer",
    },
    ".cm-relay-diff-picker-toggle": {
      order: "1",
      flexShrink: "0",
      margin: "0.25rem 0.75rem 0.25rem 0",
      padding: "2px 8px",
      border: `1px solid ${dim}`,
      borderRadius: "3px",
      background: "transparent",
      color: cyan,
      font: "inherit",
      fontSize: "0.8em",
      cursor: "pointer",
    },
    ".cm-relay-diff-current:hover, .cm-relay-diff-picker-toggle:hover, .cm-relay-diff-picker-file:hover": { backgroundColor: "#292e42" },
    ".cm-relay-diff-navigation button:focus-visible": { outline: `2px solid ${yellow}`, outlineOffset: "-2px" },
    ".cm-relay-diff-picker": { padding: "0.4rem 0.75rem 0.6rem", borderTop: `1px solid ${line}` },
    ".cm-relay-diff-picker-heading": {
      display: "flex",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: "0.25rem 1rem",
      marginBottom: "0.35rem",
      font: "0.75em/1.7 system-ui, sans-serif",
      color: muted,
    },
    ".cm-relay-diff-picker-key": { marginLeft: "0.6em", color: muted },
    ".cm-relay-diff-picker-hint": { paddingTop: "0.35rem", font: "0.75em/1.7 system-ui, sans-serif", color: muted },
    ".cm-relay-diff-picker-list": { maxHeight: "min(35vh, 18rem)", overflowY: "auto", overscrollBehavior: "contain" },
    ".cm-relay-diff-picker-file": {
      display: "flex",
      alignItems: "baseline",
      gap: "0.6rem",
      boxSizing: "border-box",
      width: "100%",
      padding: "5px 8px",
      border: "none",
      borderRadius: "3px",
      background: "transparent",
      color: fg,
      font: "inherit",
      fontSize: "0.85em",
      textAlign: "left",
      cursor: "pointer",
    },
    ".cm-relay-diff-picker-file .cm-relay-diff-path": { fontSize: "inherit" },
    ".cm-relay-diff-picker-file[aria-current]": { backgroundColor: "#292e42", color: cyan },
    ".cm-relay-diff-picker-dot": { flexShrink: "0", width: "0.65em", color: cyan, visibility: "hidden" },
    ".cm-relay-diff-picker-file[aria-current] .cm-relay-diff-picker-dot": { visibility: "visible" },
    ".cm-relay-diff-picker-add, .cm-relay-diff-picker-del": { flexShrink: "0", minWidth: "2ch", textAlign: "right" },
    ".cm-relay-diff-picker-add": { color: green },
    ".cm-relay-diff-picker-del": { color: red },
    ".cm-relay-diff-path": {
      display: "flex",
      flex: "1",
      minWidth: "0",
      fontSize: "0.85em",
    },
    ".cm-relay-diff-directory, .cm-relay-diff-basename": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    ".cm-relay-diff-basename": { flexShrink: "0", maxWidth: "100%" },
    ".cm-relay-diff-hunk": { borderTop: `1px solid ${line}` },
    ".cm-relay-diff-note, .cm-relay-diff-note span": {
      color: `${muted} !important`,
      fontStyle: "italic !important",
    },

    ".cm-relay-comment, .cm-relay-comment.cm-relay-add-line, .cm-relay-comment.cm-relay-touched": {
      backgroundColor: commentWash,
      boxShadow: `inset 2px 0 0 ${yellow}`,
    },
    ".cm-relay-comment, .cm-relay-comment span": {
      color: `${human} !important`,
      fontStyle: "normal !important",
    },

    ".cm-relay-fold": {
      padding: "0 0.75rem",
      color: muted,
      fontSize: "0.85em",
      cursor: "pointer",
    },
    ".cm-relay-fold:hover": { color: orange },

    ".cm-relay-tick": {
      display: "inline-block",
      width: "1em",
      height: "1em",
      lineHeight: "1em",
      border: `1px solid ${dim}`,
      borderRadius: "3px",
      verticalAlign: "-0.15em",
      textAlign: "center",
      fontSize: "0.9em",
    },
    ".cm-relay-ticked": { borderColor: green, background: green, color: bg },

    ".cm-relay-render": { padding: "0.4rem 0.75rem" },
    ".cm-relay-box": {
      padding: "0.7rem 0.9rem",
      background: "#1b1c29",
      border: `1px solid ${line}`,
      borderRadius: "4px",
      overflowX: "auto",
      font: '14px/1.55 ui-sans-serif, -apple-system, system-ui, sans-serif',
      color: fg,
      whiteSpace: "normal",
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
    ".cm-relay-diagram svg": { display: "block", margin: "0 auto" },
    ".cm-relay-failed": { padding: "0 0.75rem", color: red, whiteSpace: "pre-wrap" },

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

const headingLine = `calc(${size * leading}px + 0.6 * (1em - ${size}px))`;

export const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: blue, fontWeight: "700", fontSize: "1.7em", lineHeight: headingLine },
  { tag: t.heading2, color: blue, fontWeight: "700", fontSize: "1.35em", lineHeight: headingLine },
  { tag: t.heading3, color: cyan, fontWeight: "700", fontSize: "1.15em", lineHeight: headingLine },
  { tag: [t.heading4, t.heading5, t.heading6], color: cyan, fontWeight: "700" },
  { tag: t.strong, color: "#e6eaff", fontWeight: "700" },
  { tag: t.emphasis, color: fg, fontStyle: "italic" },
  { tag: t.strikethrough, color: dim, textDecoration: "line-through" },
  { tag: t.link, color: cyan, textDecoration: "underline" },
  { tag: t.url, color: muted },
  { tag: [t.monospace], class: "cm-relay-code" },
  { tag: t.quote, color: muted, fontStyle: "italic" },
  { tag: t.list, color: magenta },
  { tag: t.contentSeparator, color: dim },
  { tag: t.processingInstruction, color: dim },
  { tag: t.labelName, color: orange },

  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword, t.modifier, t.self], color: magenta },
  { tag: [t.string, t.special(t.string), t.regexp], color: green },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.escape, t.character], color: orange },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta], color: muted, fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace, t.changed], color: teal },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.propertyName, t.macroName], color: blue },
  { tag: [t.standard(t.variableName), t.special(t.variableName)], color: cyan },
  { tag: [t.variableName, t.definition(t.variableName)], color: fg },
  { tag: t.tagName, color: red },
  { tag: t.attributeName, color: orange },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: punct },
  { tag: t.invalid, color: red },
]);

export const markdownHighlight = syntaxHighlighting(highlightStyle);

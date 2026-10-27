import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const role = (name: string) => `var(--${name})`;
const wash = (name: string, percent: 12 | 18 | 35) => `color-mix(in srgb, var(--${name}) ${percent}%, transparent)`;
const edge = (name: string) => `inset 2px 0 0 var(--${name})`;

const yours = role("yours");
const title = role("title");
const fg = role("fg");
const dim = role("dim");
const faint = role("faint");
const accent = role("accent");
const ref = role("ref");
const added = role("added");
const removed = role("removed");
const working = role("working");
const idle = role("idle");
const needs = role("needs");
const caret = role("caret");
const deep = role("deep");
const pane = role("pane");
const surface = role("surface");
const hover = role("hover");
const line = role("line");
const mono = role("mono");
const sans = role("sans");

const size = 15;
const leading = 1.7;

export const theme = EditorView.theme(
  {
    "&": { color: fg, backgroundColor: deep, height: "100%", fontSize: `${size}px` },
    ".cm-scroller": {
      fontFamily: mono,
      lineHeight: `${leading}`,
      overflowX: "hidden",
      width: "100%",
      maxWidth: "calc(96ch + 4rem)",
      margin: "0 auto",
    },
    ".cm-content": {
      padding: "1.25rem 0 45vh 0",
      caretColor: caret,
    },
    ".cm-line": { padding: "0 12px" },

    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRight: "none",
      color: faint,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 12px",
      minWidth: "3ch",
    },

    "&.cm-focused .cm-cursor": { borderLeftColor: caret, borderLeftWidth: "2px" },
    "&.cm-focused .cm-fat-cursor": { background: caret, outline: "none" },
    "&:not(.cm-focused) .cm-fat-cursor": { background: "none", outline: `1px solid ${caret}` },
    ".cm-fat-cursor-mark": { background: caret },

    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      {
        background: role("selection"),
      },
    ".cm-activeLine": { backgroundColor: "transparent" },

    ".cm-relay-add, .cm-relay-add span, .cm-relay-add-line, .cm-relay-add-line span": {
      color: `${yours} !important`,
      fontStyle: "normal !important",
    },
    ".cm-relay-add": {
      backgroundColor: wash("added", 18),
      borderRadius: "var(--radius-mark)",
    },
    ".cm-relay-add-line": {
      backgroundColor: wash("added", 12),
      boxShadow: edge("added"),
    },
    ".cm-relay-touched": { boxShadow: edge("added") },

    ".cm-relay-del, .cm-relay-del span": { color: `${removed} !important` },
    ".cm-relay-del": {
      backgroundColor: wash("removed", 12),
      textDecoration: "line-through",
      textDecorationColor: wash("removed", 35),
      borderRadius: "var(--radius-mark)",
    },
    ".cm-relay-del-block": {
      backgroundColor: wash("removed", 12),
      boxShadow: edge("removed"),
    },
    ".cm-relay-del-line": {
      padding: "0 12px",
      color: removed,
      textDecoration: "line-through",
      textDecorationColor: wash("removed", 35),
      whiteSpace: "pre-wrap",
    },
    ".cm-relay-del-more": {
      padding: "0 12px",
      color: dim,
      fontSize: "13px",
    },

    ".cm-relay-tty": {
      margin: "4px 12px",
      padding: "6px",
      backgroundColor: surface,
      border: `1px solid ${line}`,
      borderRadius: "var(--radius-box)",
      boxShadow: edge("working"),
      overflow: "hidden",
    },
    ".cm-relay-tty:focus-within": { borderColor: accent },
    ".cm-run-status": {
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "4px 12px",
      padding: "4px 12px",
      backgroundColor: pane,
      boxShadow: edge("line"),
      font: `11px/1.5 ${mono}`,
      color: dim,
    },
    ".cm-run-phase": { fontWeight: "600" },
    ".cm-run-running": { boxShadow: edge("working") },
    ".cm-run-running .cm-run-phase": { color: working },
    ".cm-run-queued": { boxShadow: edge("idle") },
    ".cm-run-queued .cm-run-phase": { color: idle },
    ".cm-run-failed": { boxShadow: edge("removed") },
    ".cm-run-failed .cm-run-phase": { color: removed },
    ".cm-run-stopped, .cm-run-skipped": { boxShadow: edge("needs") },
    ".cm-run-stopped .cm-run-phase, .cm-run-skipped .cm-run-phase": { color: needs },
    ".cm-run-status button": { marginLeft: "auto", padding: "0 9px" },
    ".cm-run-status button[hidden]": { display: "none" },

    ".cm-relay-fence": { backgroundColor: pane },
    ".cm-relay-code": { color: fg, backgroundColor: pane, borderRadius: "var(--radius-mark)" },
    ".cm-relay-fence .cm-relay-code": { backgroundColor: "transparent" },

    ".cm-relay-diff-add": { backgroundColor: wash("added", 12) },
    ".cm-relay-diff-del": { backgroundColor: wash("removed", 12) },
    ".cm-relay-diff-add-word": {
      backgroundColor: wash("added", 18),
      borderRadius: "var(--radius-mark)",
    },
    ".cm-relay-diff-del-word": {
      backgroundColor: wash("removed", 18),
      borderRadius: "var(--radius-mark)",
    },
    ".cm-relay-diff-mark": { color: faint },
    ".cm-relay-diff-file, .cm-relay-diff-file span": { color: `${ref} !important` },
    ".cm-relay-diff-file": { backgroundColor: wash("ref", 12), fontWeight: "600" },
    ".cm-relay-diff-navigation": {
      flexShrink: "0",
      boxSizing: "border-box",
      width: "100%",
      maxWidth: "calc(96ch + 4rem)",
      margin: "0 auto",
      borderBottom: `1px solid ${line}`,
      backgroundColor: pane,
      font: `13px/1.5 ${mono}`,
    },
    ".cm-relay-diff-navigation [hidden], .cm-relay-diff-navigation[hidden]": { display: "none" },
    ".cm-relay-diff-bar": { display: "flex", alignItems: "center" },
    ".cm-relay-diff-current": {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      flex: "1",
      minWidth: "0",
      order: "0",
      padding: "6px 12px",
      border: "none",
      background: "transparent",
      color: ref,
      font: "inherit",
      textAlign: "left",
      cursor: "pointer",
    },
    ".cm-relay-diff-current:hover": { backgroundColor: hover },
    ".cm-relay-diff-picker-toggle": {
      order: "1",
      flexShrink: "0",
      margin: "4px 12px 4px 0",
      padding: "3px 9px",
      border: `1px solid ${line}`,
      borderRadius: "var(--radius-control)",
      background: "transparent",
      color: dim,
      font: "inherit",
      fontSize: "11px",
      cursor: "pointer",
    },
    ".cm-relay-diff-picker-toggle:hover": { color: fg, backgroundColor: hover },
    ".cm-relay-diff-picker": { padding: "6px 12px 8px", borderTop: `1px solid ${line}` },
    ".cm-relay-diff-picker-heading": {
      display: "flex",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: "4px 16px",
      marginBottom: "6px",
      fontSize: "11px",
      color: dim,
    },
    ".cm-relay-diff-picker-key": { marginLeft: "8px", color: dim },
    ".cm-relay-diff-picker-hint": { paddingTop: "6px", fontSize: "11px", color: dim },
    ".cm-relay-diff-picker-list": { maxHeight: "min(35vh, 18rem)", overflowY: "auto", overscrollBehavior: "contain" },
    ".cm-relay-diff-picker-file": {
      display: "flex",
      alignItems: "baseline",
      gap: "8px",
      boxSizing: "border-box",
      width: "100%",
      padding: "5px 8px",
      border: "none",
      borderRadius: "var(--radius-box)",
      background: "transparent",
      color: fg,
      font: "inherit",
      textAlign: "left",
      cursor: "pointer",
    },
    ".cm-relay-diff-picker-file:hover": { backgroundColor: hover },
    ".cm-relay-diff-picker-file .cm-relay-diff-path": { fontSize: "inherit" },
    ".cm-relay-diff-picker-file[aria-current]": { backgroundColor: wash("ref", 12), boxShadow: edge("ref"), color: title },
    ".cm-relay-diff-picker-file[aria-current]:hover": { backgroundColor: wash("ref", 18) },
    ".cm-relay-diff-picker-dot": { flexShrink: "0", width: "0.65em", color: ref, visibility: "hidden" },
    ".cm-relay-diff-picker-file[aria-current] .cm-relay-diff-picker-dot": { visibility: "visible" },
    ".cm-relay-diff-picker-add, .cm-relay-diff-picker-del": { flexShrink: "0", minWidth: "2ch", textAlign: "right" },
    ".cm-relay-diff-picker-add": { color: added },
    ".cm-relay-diff-picker-del": { color: removed },
    ".cm-relay-diff-path": {
      display: "flex",
      flex: "1",
      minWidth: "0",
    },
    ".cm-relay-diff-directory, .cm-relay-diff-basename": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    ".cm-relay-diff-basename": { flexShrink: "0", maxWidth: "100%" },
    ".cm-relay-diff-hunk": { borderTop: `1px solid ${line}` },
    ".cm-relay-diff-note, .cm-relay-diff-note span": {
      color: `${dim} !important`,
      fontStyle: "italic !important",
    },

    ".cm-relay-comment, .cm-relay-comment.cm-relay-add-line, .cm-relay-comment.cm-relay-touched": {
      backgroundColor: wash("needs", 12),
      boxShadow: edge("needs"),
    },
    ".cm-relay-comment, .cm-relay-comment span": {
      color: `${yours} !important`,
      fontStyle: "normal !important",
    },

    ".cm-relay-fold": {
      padding: "0 12px",
      color: dim,
      fontSize: "13px",
      cursor: "pointer",
    },
    ".cm-relay-fold:hover": { color: accent },

    ".cm-relay-tick": {
      display: "inline-block",
      width: "1em",
      height: "1em",
      lineHeight: "1em",
      border: `1px solid ${faint}`,
      borderRadius: "var(--radius-control)",
      verticalAlign: "-0.15em",
      textAlign: "center",
      fontSize: "0.9em",
    },
    ".cm-relay-ticked": { borderColor: added, background: added, color: deep },

    ".cm-relay-render": { padding: "6px 12px" },
    ".cm-relay-box": {
      padding: "9px 10px",
      background: surface,
      border: `1px solid ${line}`,
      borderRadius: "var(--radius-box)",
      overflowX: "auto",
      font: `14px/1.5 ${sans}`,
      color: fg,
      whiteSpace: "normal",
    },
    ".cm-relay-box > :first-child": { marginTop: 0 },
    ".cm-relay-box > :last-child": { marginBottom: 0 },
    ".cm-relay-render table": { borderCollapse: "collapse" },
    ".cm-relay-render th, .cm-relay-render td": {
      border: `1px solid ${line}`,
      padding: "4px 10px",
      textAlign: "left",
      verticalAlign: "top",
    },
    ".cm-relay-render th": { color: title, fontWeight: "600" },
    ".cm-relay-render img, .cm-relay-render svg": { maxWidth: "100%", height: "auto" },
    ".cm-relay-render a": { color: ref },
    ".cm-relay-render code": { fontFamily: mono, color: fg, backgroundColor: pane, borderRadius: "var(--radius-mark)" },
    ".cm-relay-render summary": { cursor: "pointer", color: accent },
    ".cm-relay-blocked": { color: needs },
    ".cm-relay-diagram svg": { display: "block", margin: "0 auto" },
    ".cm-relay-failed": {
      margin: "0 12px",
      padding: "9px 10px",
      color: needs,
      backgroundColor: wash("needs", 12),
      border: `1px solid ${wash("needs", 35)}`,
      borderRadius: "var(--radius-box)",
      font: `11px/1.5 ${mono}`,
      whiteSpace: "pre-wrap",
    },

    ".cm-panels": { backgroundColor: pane, color: fg },
    ".cm-panel.cm-search input, .cm-panel.cm-search button": {
      backgroundColor: pane,
      color: fg,
      border: `1px solid ${line}`,
      borderRadius: "var(--radius-control)",
    },
    ".cm-vim-panel": {
      backgroundColor: pane,
      color: fg,
      padding: "4px 16px",
      borderTop: `1px solid ${line}`,
    },
    ".cm-vim-panel input": { color: fg, fontFamily: "inherit" },
  },
  { dark: true },
);

const headingLine = `calc(${size * leading}px + 0.6 * (1em - ${size}px))`;

export const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: title, fontWeight: "600", fontSize: "1.7em", lineHeight: headingLine },
  { tag: t.heading2, color: title, fontWeight: "600", fontSize: "1.35em", lineHeight: headingLine },
  { tag: t.heading3, color: title, fontWeight: "600", fontSize: "1.15em", lineHeight: headingLine },
  { tag: [t.heading4, t.heading5, t.heading6], color: title, fontWeight: "600" },
  { tag: t.strong, color: title, fontWeight: "600" },
  { tag: t.emphasis, color: fg, fontStyle: "italic" },
  { tag: t.strikethrough, color: faint, textDecoration: "line-through" },
  { tag: t.link, color: ref, textDecoration: "underline" },
  { tag: t.url, color: dim },
  { tag: [t.monospace], class: "cm-relay-code" },
  { tag: t.quote, color: dim, fontStyle: "italic" },
  { tag: t.list, color: faint },
  { tag: t.contentSeparator, color: faint },
  { tag: t.processingInstruction, color: faint },
  { tag: t.labelName, color: needs },

  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword, t.modifier, t.self], color: role("mauve") },
  { tag: [t.string, t.special(t.string), t.regexp], color: role("green") },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.escape, t.character], color: role("peach") },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta], color: faint, fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace, t.changed], color: role("teal") },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.propertyName, t.macroName], color: role("blue") },
  { tag: [t.standard(t.variableName), t.special(t.variableName)], color: role("sky") },
  { tag: [t.variableName, t.definition(t.variableName)], color: fg },
  { tag: t.tagName, color: role("red") },
  { tag: t.attributeName, color: role("peach") },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: dim },
  { tag: t.invalid, color: role("red") },
]);

export const markdownHighlight = syntaxHighlighting(highlightStyle);

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
const teal = "#2ac3de";
const green = "#9ece6a";
const orange = "#ff9e64";
const magenta = "#bb9af7";
const red = "#f7768e";
const punct = "#9aa5ce";
const human = "#ffffff";
const addWash = "rgba(158, 206, 106, 0.22)";
const delWash = "rgba(247, 118, 142, 0.12)";
// A reviewed diff, whose lines are the agent's rather than the human's: the same
// two colours, weaker, so that the human's own edits still read as the loudest
// thing on the screen. Yellow is the third colour, and it is free — which is
// half of why a comment is yellow; the human asking for it is the other half.
const yellow = "#e0af68";
const diffAddWash = "rgba(158, 206, 106, 0.13)";
const diffDelWash = "rgba(247, 118, 142, 0.13)";
const diffFileWash = "rgba(122, 162, 247, 0.2)";
const commentWash = "rgba(224, 175, 104, 0.22)";
// Code is washed rather than filled, and that is the whole reason it is written
// as an rgba here. A highlight style paints on the text's own span, and those
// sit above the layer drawSelection draws the selection into — so an opaque
// colour on this one tag hid the visual-mode selection on every line of code and
// inside every `span` of inline code. Translucent, it shows through instead.
// The same holds for the line class in fence.ts, for the same reason.
const codeWash = "rgba(122, 162, 247, 0.11)";

// The document's own size and leading, in one place because the heading rule at
// the bottom of this file is derived from them.
const size = 15;
const leading = 1.7;

export const theme = EditorView.theme(
  {
    "&": { color: fg, backgroundColor: bg, height: "100%", fontSize: `${size}px` },
    // The measure is centred here rather than on .cm-content, because the line
    // number gutter is a sibling pinned to the left edge of the scroller: centre
    // the content and the numbers strand themselves across the window from it.
    ".cm-scroller": {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      lineHeight: `${leading}`,
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

    // Code. The tint is what marks a block as code; the colours inside it come
    // from the highlight style at the bottom of this file. Inline code is tinted
    // on its own span, the only way to tint a few words mid-sentence — but that
    // span inside a fence would stack a second tint on the line's, so it stands
    // down there.
    ".cm-relay-fence": { backgroundColor: codeWash },
    ".cm-relay-code": { color: green, backgroundColor: codeWash },
    ".cm-relay-fence .cm-relay-code": { backgroundColor: "transparent" },

    // A diff, reviewed. A wash the full width of the line and not just the width
    // of its text, so a hunk scans as blocks; translucent, for the reason
    // `codeWash` gives, since these land on `.cm-line` above the layer
    // drawSelection paints into.
    //
    // Below the fence wash on purpose. Both are one class on the same element,
    // so the rule further down is the one that paints: a changed line takes its
    // own colour and a context line keeps the blue of code, which is what it
    // still is. No bar down the left either — in this window the bar means the
    // human touched this line, and these are the agent's.
    ".cm-relay-diff-add": { backgroundColor: diffAddWash },
    ".cm-relay-diff-del": { backgroundColor: diffDelWash },
    // The `+` and the `-`. They are still in the text — the patch is made of them
    // — but the wash has already said which line is which, so they are read as
    // punctuation and set at the weight of punctuation. Dimmer than the code and
    // the same colour as the numbers in the gutter, which are the other thing on
    // the line that is about the line rather than in it.
    ".cm-relay-diff-mark": { color: dim },
    // The strip naming the file, and the `@@` header standing between hunks.
    // Structure rather than content. The `span` half of the selector is for
    // anything the live diff puts inside such a line when the human edits one:
    // nothing else paints here, since a header is not code and diffcode.ts leaves
    // it alone.
    ".cm-relay-diff-file, .cm-relay-diff-file span": { color: `${cyan} !important` },
    ".cm-relay-diff-file": { backgroundColor: diffFileWash, fontWeight: "700" },
    ".cm-relay-diff-hunk": { borderTop: `1px solid ${line}` },
    ".cm-relay-diff-note, .cm-relay-diff-note span": {
      color: `${dim} !important`,
      fontStyle: "italic !important",
    },

    // A comment: the one line in a diff the human wrote, and the only one with a
    // bar beside it.
    //
    // It is new text, so the live diff calls the same line an addition and puts
    // its own green class on it. Both are line classes on `.cm-line`, which is
    // why the green is named here as well as the yellow: a single class would
    // tie with it and leave the answer to whichever rule happened to be written
    // last, and a comment that comes out half green is the one thing this must
    // never do.
    ".cm-relay-comment, .cm-relay-comment.cm-relay-add-line, .cm-relay-comment.cm-relay-touched": {
      backgroundColor: commentWash,
      boxShadow: `inset 2px 0 0 ${yellow}`,
    },
    ".cm-relay-comment, .cm-relay-comment span": {
      color: `${human} !important`,
      fontStyle: "normal !important",
    },

    // The head of a long output, folded away. Every line it stands for is still
    // in the document — this is a fold, not a truncation — so it reads as a way
    // in rather than as a warning that something was lost.
    ".cm-relay-fold": {
      padding: "0 0.75rem",
      color: dim,
      fontSize: "0.85em",
      cursor: "pointer",
    },
    ".cm-relay-fold:hover": { color: orange },


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
      // The editor keeps every space and newline of the source, which is right
      // for the document and wrong for what has been rendered out of it: the
      // newlines between pretty-printed tags became blank lines on screen, so a
      // diagram written to be read in the source came out half again as tall,
      // with gaps nothing in its CSS asked for. Inside the box the markup is
      // markup again.
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
    // Stands in for an image whose file was not there.
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

/**
 * How tall a heading's line is allowed to be.
 *
 * A line number is drawn at the top of its line, so a heading set larger than
 * the text around it has to be careful with leading: half of whatever a line
 * box has spare goes above the glyphs, and every pixel of that is a pixel the
 * heading sinks below its own number. Leaving each heading a fixed multiple of
 * its size — a big heading, so a big multiple — is what had the numbers sitting
 * visibly high beside them.
 *
 * So the leading a heading gets is only what keeps the two level: the document
 * line height, plus a small share of the size the heading gained. The share is
 * measured — it is where the face's cap height sits against half the spread of
 * its ascenders and descenders — and holds for every heading level, which is
 * why one rule covers them all. Headings are separated from their surroundings
 * by the blank line markdown asks for either way.
 */
const headingLine = `calc(${size * leading}px + 0.6 * (1em - ${size}px))`;

// Markdown is styled rather than merely monospaced: headings carry real weight
// and size, so the document reads as a document. What a nested code language
// sends up is styled here too — same tags, same mechanism, one style.
//
// Exported as well as installed, because a HighlightStyle can be asked which
// class it gives a tag: that is how languages.test.ts checks these rules rather
// than a copy of them.
export const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: blue, fontWeight: "700", fontSize: "1.7em", lineHeight: headingLine },
  { tag: t.heading2, color: blue, fontWeight: "700", fontSize: "1.35em", lineHeight: headingLine },
  { tag: t.heading3, color: cyan, fontWeight: "700", fontSize: "1.15em", lineHeight: headingLine },
  { tag: [t.heading4, t.heading5, t.heading6], color: cyan, fontWeight: "700" },
  { tag: t.strong, color: "#e6eaff", fontWeight: "700" },
  { tag: t.emphasis, color: fg, fontStyle: "italic" },
  { tag: t.strikethrough, color: dim, textDecoration: "line-through" },
  { tag: t.link, color: cyan, textDecoration: "underline" },
  { tag: t.url, color: dim },
  // A fixed class rather than colours, so the theme above can tell inline code
  // from the text of a fence nothing was nested into. One tag does both jobs.
  { tag: [t.monospace], class: "cm-relay-code" },
  { tag: t.quote, color: dim, fontStyle: "italic" },
  { tag: t.list, color: magenta },
  { tag: t.contentSeparator, color: dim },
  { tag: t.processingInstruction, color: dim },
  // A fence's own language tag and a markdown link label are the same tag.
  { tag: t.labelName, color: orange },

  // Code. Nine roles, which is about as many as a reader tells apart at a glance,
  // and every colour is one the document already uses somewhere.
  //
  // Foreground only, all of them. A background here lands on the token's own
  // span, above the selection layer — the mistake `codeWash` is an rgba to avoid.
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword, t.modifier, t.self], color: magenta },
  { tag: [t.string, t.special(t.string), t.regexp], color: green },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.escape, t.character], color: orange },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta], color: dim, fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace, t.changed], color: teal },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.propertyName, t.macroName], color: blue },
  { tag: [t.standard(t.variableName), t.special(t.variableName)], color: cyan },
  { tag: [t.variableName, t.definition(t.variableName)], color: fg },
  // Markup: the tag is what you scan for, the attribute hangs off it.
  { tag: t.tagName, color: red },
  { tag: t.attributeName, color: orange },
  // No rule for t.inserted or t.deleted, and that is the whole of how a reviewed
  // diff comes to look like code. Those two tags are what a diff mode emits, and
  // a rule for them paints an added line of TypeScript green from end to end
  // instead of painting TypeScript. So a ```diff fence is given no diff mode at
  // all (languages.ts) and what is added and what is removed is said by the wash
  // under the line (diffview.ts) — leaving the foreground to the rules above, in
  // the language of the file the patch touches.
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: punct },
  { tag: t.invalid, color: red },
]);

export const markdownHighlight = syntaxHighlighting(highlightStyle);

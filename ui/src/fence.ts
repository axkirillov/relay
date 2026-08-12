import { syntaxTree } from "@codemirror/language";
import { type EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * The wash that says "this is code", now that the tag no longer can.
 *
 * A fenced block used to be tinted by the highlight style: lang-markdown tags
 * `CodeText` as monospace, and that rule carries a background. But nesting a
 * language into the fence mounts its tree over exactly that node, and a mounted
 * node's own tag is not applied — measured, not assumed. So the moment a fence
 * says `ts` its text stops being monospace-tagged, and with it went the tint. A
 * document would have shown recognised blocks bare and unrecognised ones tinted:
 * two kinds of code block, for no reason a reader could see.
 *
 * A line decoration is a better answer than the tag was anyway. It runs the full
 * width of the line rather than stopping where the text does, so a block reads as
 * a block — margins, blank lines and the ``` fences included — instead of as
 * ragged highlighting. Inline code keeps the span tint it always had; the theme
 * turns that one off inside a fence so the two do not stack.
 *
 * Translucent, for the reason spelled out over `codeWash` in theme.ts: this class
 * lands on `.cm-line`, inside `.cm-content`, which sits above the layer
 * drawSelection paints into. Opaque, it would hide the visual-mode selection.
 */
const fenceLine = Decoration.line({ class: "cm-relay-fence" });

/**
 * Every line of code between `from` and `to`, by 1-based line number.
 *
 * Indented code blocks are in here as well as fenced ones. Nothing is nested into
 * those — there is no info string to name a language — but they were tinted before
 * this existed, by the same monospace tag, and they should stay tinted.
 */
export function codeLines(state: EditorState, from: number, to: number): number[] {
  const lines: number[] = [];

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== "FencedCode" && node.name !== "CodeBlock") return undefined;
      for (let pos = Math.max(node.from, from); pos <= Math.min(node.to, to); ) {
        const line = state.doc.lineAt(pos);
        lines.push(line.number);
        pos = line.to + 1;
      }
      // The nested tree is mounted inside this node. Nothing below is code in its
      // own right, and lezer would hand back the language's own nodes.
      return false;
    },
  });

  return lines;
}

function fences(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // A range set is built in order, and a block spanning two visible ranges is
  // entered once per range — so the line it shares is offered twice.
  let last = 0;

  for (const { from, to } of view.visibleRanges) {
    for (const number of codeLines(view.state, from, to)) {
      if (number <= last) continue;
      builder.add(view.state.doc.line(number).from, view.state.doc.line(number).from, fenceLine);
      last = number;
    }
  }

  return builder.finish();
}

/**
 * A view plugin, not a state field: these are line decorations, which CodeMirror
 * is happy to take from a plugin — only the block widgets in render.ts have to be
 * computed over the whole document before anything is drawn. So this one does the
 * viewport and no more.
 */
export const fenceBackground = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = fences(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = fences(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

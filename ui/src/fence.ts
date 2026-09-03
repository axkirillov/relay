import { syntaxTree } from "@codemirror/language";
import { type EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const fenceLine = Decoration.line({ class: "cm-relay-fence" });

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
      return false;
    },
  });

  return lines;
}

function fences(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
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

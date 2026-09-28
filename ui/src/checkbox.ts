import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

export type Box = { from: number; to: number; ticked: boolean };

export function boxes(state: EditorState, from = 0, to = state.doc.length): Box[] {
  const found: Box[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== "TaskMarker") return undefined;
      const text = state.sliceDoc(node.from, node.to);
      found.push({ from: node.from, to: node.to, ticked: text[1] !== " " });
      return false;
    },
  });
  return found;
}

export function boxAt(state: EditorState, pos: number): Box | null {
  const line = state.doc.lineAt(pos);
  return boxes(state, line.from, line.to).find((b) => b.from >= line.from && b.to <= line.to) ?? null;
}

export function toggle(box: Box): { from: number; to: number; insert: string } {
  return { from: box.from + 1, to: box.from + 2, insert: box.ticked ? " " : "x" };
}

export function toggleAtCursor(view: EditorView): boolean {
  const box = boxAt(view.state, view.state.selection.main.head);
  if (!box) return false;
  view.dispatch({ changes: toggle(box), userEvent: "input.toggle" });
  return true;
}

class Tick extends WidgetType {
  ticked: boolean;
  constructor(ticked: boolean) {
    super();
    this.ticked = ticked;
  }
  eq(other: Tick) {
    return other.ticked === this.ticked;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.ticked ? "cm-relay-tick cm-relay-ticked" : "cm-relay-tick";
    el.textContent = this.ticked ? "✓" : "";
    return el;
  }
}

function draw(view: EditorView): DecorationSet {
  const head = view.state.selection.main.head;
  const marks: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (const box of boxes(view.state, from, to)) {
      if (head > box.from && head < box.to) continue;
      marks.push(Decoration.replace({ widget: new Tick(box.ticked) }).range(box.from, box.to));
    }
  }
  return Decoration.set(marks, true);
}

export const checkboxes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = draw(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = draw(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

import { syntaxTree } from "@codemirror/language";
import { type EditorState, StateEffect, StateField } from "@codemirror/state";

type SyntaxNode = {
  name: string;
  from: number;
  to: number;
  parent: SyntaxNode | null;
  firstChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
};

const shells = new Set(["sh", "bash", "zsh", "shell", "console"]);

export const outputFence = "````";
export const outputInfo = "output";

export type ShellBlock = {
  from: number;
  to: number;
  lang: string;
  command: string;
};

export function isShellLang(info: string): boolean {
  return shells.has(info.trim().toLowerCase().split(/[\s,{]/)[0] ?? "");
}

export function commandOf(code: string): string {
  return code
    .split("\n")
    .map((line) => line.replace(/^(\s*)[$%]\s+/, "$1"))
    .join("\n")
    .trim();
}

export function shellBlockAt(state: EditorState, pos: number): ShellBlock | null {
  const fence = fenceAt(state, pos);
  if (!fence) return null;

  const lang = childText(state, fence, "CodeInfo");
  if (!isShellLang(lang)) return null;

  const command = commandOf(childText(state, fence, "CodeText"));
  if (!command) return null;

  return { from: fence.from, to: state.doc.lineAt(fence.to).to, lang: lang.trim(), command };
}

function fenceAt(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(pos, side) as unknown as SyntaxNode;
    for (; node; node = node.parent) if (node.name === "FencedCode") return node;
  }
  return null;
}

function childText(state: EditorState, node: SyntaxNode, name: string): string {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return state.doc.sliceString(child.from, child.to);
  }
  return "";
}

export type Insertion = {
  from: number;
  to: number;
  insert: string;
  at: number;
};

export function startOutput(state: EditorState, block: ShellBlock): Insertion {
  const previous = adjacentOutput(state, block);
  const open = `\n\n${outputFence}${outputInfo}\n`;
  return {
    from: block.to,
    to: previous ? state.doc.lineAt(previous.to).to : block.to,
    insert: open + outputFence,
    at: block.to + open.length,
  };
}

function adjacentOutput(state: EditorState, block: ShellBlock): SyntaxNode | null {
  const next = nextFence(state, block.to);
  if (!next) return null;
  if (childText(state, next, "CodeInfo").trim() !== outputInfo) return null;
  if (state.doc.sliceString(block.to, next.from).trim() !== "") return null;
  return next;
}

function nextFence(state: EditorState, after: number): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    from: after,
    to: state.doc.length,
    enter: (node) => {
      if (found) return false;
      if (node.name !== "FencedCode" || node.from < after) return undefined;
      found = node.node as unknown as SyntaxNode;
      return false;
    },
  });
  return found;
}

export const setSink = StateEffect.define<number | null>();

export const sink = StateField.define<number | null>({
  create: () => null,
  update(pos, tr) {
    for (const e of tr.effects) if (e.is(setSink)) return e.value;
    if (pos === null) return null;
    return tr.changes.mapPos(pos, 1);
  },
});

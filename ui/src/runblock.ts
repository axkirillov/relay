import { syntaxTree } from "@codemirror/language";
import { type EditorState, StateEffect, StateField } from "@codemirror/state";

// Structural, so the tree types need not be a direct dependency — the same
// handful of fields render.ts leans on.
type SyntaxNode = {
  name: string;
  from: number;
  to: number;
  parent: SyntaxNode | null;
  firstChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
};

/**
 * A fence whose language means "this is a command", rather than "this is what
 * code looks like". Nothing new for an agent to learn: it already writes a
 * command in a shell fence, and in a relay document a shell command is a
 * request, not decoration.
 */
const shells = new Set(["sh", "bash", "zsh", "shell", "console"]);

/** Four backticks, so output with a ``` fence in it cannot end the block. */
export const outputFence = "````";
export const outputInfo = "output";

export type ShellBlock = {
  /** The whole fence, opening mark to the end of the closing mark's line. */
  from: number;
  to: number;
  lang: string;
  /** What runs: the block's own lines, with any shell prompt taken off. */
  command: string;
};

export function isShellLang(info: string): boolean {
  return shells.has(info.trim().toLowerCase().split(/[\s,{]/)[0] ?? "");
}

/**
 * A prompt is not part of the command.
 *
 * A `console` block is written as a session — `$ pnpm test` — and a `$ ` at the
 * start of a line is never a command in its own right, so taking it off can only
 * help. Interleaved output in such a block is beyond saving; the human sees what
 * happened and can put it back with `:res`.
 */
export function commandOf(code: string): string {
  return code
    .split("\n")
    .map((line) => line.replace(/^(\s*)[$%]\s+/, "$1"))
    .join("\n")
    .trim();
}

/** The runnable block the cursor is in, if it is in one. */
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
  // Both sides: the caret may sit against the opening or closing mark, which
  // resolves outside the fence on one association and inside it on the other.
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
  /** The stretch to replace — empty unless a previous run is being replaced. */
  from: number;
  to: number;
  insert: string;
  /** Where output goes, once this insertion has been applied. */
  at: number;
};

/**
 * Where this run's output belongs.
 *
 * Directly under the command, as an ordinary fenced block — which is the whole
 * point. Output that is document text is output the diff carries back to the
 * agent, and output the human can edit, trim, or take out again with `:res`.
 *
 * Running the same block twice replaces the last run rather than stacking a
 * second copy under it: two runs of `pnpm test` are one answer, not two.
 */
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

/** The output block belonging to this command: the next fence, if only blank space lies between. */
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

/**
 * Where the output of the run in flight is being written.
 *
 * A plain number would be wrong within a keystroke: the human keeps editing
 * while a command runs, and anything they type above this moves it. Mapping it
 * through every change is what lets output keep landing in the right place while
 * the document shifts around it.
 */
export const setSink = StateEffect.define<number | null>();

export const sink = StateField.define<number | null>({
  create: () => null,
  update(pos, tr) {
    for (const e of tr.effects) if (e.is(setSink)) return e.value;
    if (pos === null) return null;
    // Association 1: output inserted *at* the sink leaves the sink after it, so
    // the next chunk lands below the last one rather than above it.
    return tr.changes.mapPos(pos, 1);
  },
});

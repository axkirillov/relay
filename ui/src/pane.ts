/**
 * What the two panes at the bottom of the window have in common.
 *
 * There are two because they are two different things: one holds a shell the
 * human opened and keeps, the other holds an nvim that lives for one file. What
 * they share is a terminal, a grip to drag, and the crossing back into the
 * document — and sharing it is what keeps the second one from being a slightly
 * different-looking copy of the first.
 */

import type { EditorView } from "@codemirror/view";
import { Terminal } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";
import { fence, insertion } from "./take";

export const mac = navigator.platform.startsWith("Mac");

/**
 * The drag that selects rows out from under a program that wants the mouse.
 *
 * nvim wants it, so a plain drag is nvim's own visual selection and never
 * xterm's — and xterm's way past that is not the same key on both platforms.
 * Saying the wrong one costs the human a gesture that does nothing.
 */
export const forceDrag = mac ? "⌥-drag" : "⇧-drag";

const paneEls = ["term", "edit"].map((id) => document.getElementById(id)!);

/** Whether a key belongs to a child process rather than to the document. */
export function inPane(target: EventTarget | null): boolean {
  return target instanceof Node && paneEls.some((pane) => pane.contains(target));
}

export function terminal(): Terminal {
  return new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.15,
    scrollback: 5000,
    // ⌥B and ⌥F are how a shell moves by words, and on a Mac they are only
    // that if this is on.
    macOptionIsMeta: true,
    // What lets a Mac select rows at all while nvim has the mouse: xterm's
    // override is ⇧ everywhere else, but on a Mac it is ⌥ and only when this is
    // on. Off, there is no gesture that selects — the drag is always nvim's.
    macOptionClickForcesSelection: true,
    theme: {
      background: "#16161e",
      foreground: "#c0caf5",
      cursor: "#ff9e64",
      cursorAccent: "#16161e",
      selectionBackground: "#3d59a1",
      black: "#1a1b26",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#565f89",
      brightRed: "#ff7a93",
      brightGreen: "#b9f27c",
      brightYellow: "#ff9e64",
      brightBlue: "#7da6ff",
      brightMagenta: "#bb9af7",
      brightCyan: "#0db9d7",
      brightWhite: "#c0caf5",
    },
  });
}

/**
 * Rows out of a pane into the document, at the caret.
 *
 * The diff is the only channel back, so this crossing is what makes either pane
 * worth having: what the human saw in there becomes text the agent is handed.
 * Returns how many rows landed, or nothing if there was nothing to take.
 */
export function intoDocument(view: EditorView, lines: string[]): number | null {
  const block = fence(lines);
  if (!block) return null;
  const { from, insert } = insertion(view.state.doc.toString(), view.state.selection.main.head, block);
  // The caret ends up under the block, so a second take stacks below the first
  // rather than on top of it.
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
  });
  return block.split("\n").length - 2;
}

/** The pane's height is the human's business — a rebase needs more of it. */
export function dragToResize(pane: HTMLElement, grip: HTMLElement) {
  grip.addEventListener("pointerdown", (down: PointerEvent) => {
    down.preventDefault();
    grip.setPointerCapture(down.pointerId);
    const startY = down.clientY;
    const startH = pane.offsetHeight;
    const move = (at: PointerEvent) => {
      const height = Math.min(Math.max(startH - (at.clientY - startY), 120), window.innerHeight - 160);
      pane.style.height = `${height}px`;
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
}

export function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

import type { EditorState } from "@codemirror/state";

import { boxAt } from "./checkbox.ts";
import { urlAt } from "./link.ts";
import { shellBlockAt } from "./runblock.ts";

export type ContextAction = { kind: "tick" | "run" | "link" | "edit" | "normal" | "close"; key: string; label: string };

export function contextAction(state: EditorState, mode: string, reading: boolean): ContextAction {
  const selection = state.selection.main;
  const box = reading ? null : boxAt(state, selection.head);
  if (box) return { kind: "tick", key: "⌃J", label: box.ticked ? "Untick" : "Tick" };
  if (shellBlockAt(state, selection.head)) return { kind: "run", key: "⌃J", label: "Run" };
  const line = state.doc.lineAt(selection.head);
  const link = selection.empty
    ? urlAt(line.text, selection.head - line.from)
    : urlAt(state.sliceDoc(selection.from, selection.to), 0);
  if (link && mode !== "insert") return { kind: "link", key: "gx", label: "Open link" };
  if (mode !== "normal") return { kind: "normal", key: "Esc", label: "Normal mode" };
  if (reading) return { kind: "close", key: ":q", label: "Close" };
  return { kind: "edit", key: "i", label: "Edit" };
}

export function shortcutHelp(focusEditor: () => void) {
  const dialog = document.getElementById("help-dialog") as HTMLDialogElement;
  const button = document.getElementById("help") as HTMLButtonElement;
  const close = document.getElementById("help-close") as HTMLButtonElement;
  const open = () => {
    if (!dialog.open) dialog.showModal();
    close.focus();
  };
  button.addEventListener("click", open);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", focusEditor);
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  return { open, isOpen: () => dialog.open };
}

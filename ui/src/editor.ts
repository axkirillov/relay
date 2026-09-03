import type { EditorView } from "@codemirror/view";
import { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

import type { Target } from "./goto";
import { decode, dragToResize, forceDrag, intoDocument, mac, terminal } from "./pane";
import type { Pane } from "./terminal";

const paneEl = document.getElementById("edit")!;
const viewEl = document.getElementById("edit-view")!;
const whereEl = document.getElementById("edit-where")!;
const gripEl = document.getElementById("edit-grip")!;

let up = false;

export function editing(): boolean {
  return up;
}

export type Editor = {
  open(target: Target): void;
};

export function editorPane(view: EditorView, note: (text: string) => void, shell: Pane): Editor {
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let stream: EventSource | null = null;
  let restore: (() => void) | null = null;

  async function open(target: Target) {
    if (up) return;
    up = true;

    let answer: Response;
    try {
      answer = await fetch("/edit", { method: "POST", body: JSON.stringify(target) });
    } catch {
      up = false;
      return note("relay is not there any more");
    }
    if (!answer.ok) {
      up = false;
      return note(await answer.text());
    }
    const { file } = (await answer.json()) as { file: string };

    restore = shell.stepAside();
    delete paneEl.dataset.hidden;
    whereEl.textContent = `nvim · ${file}${target.line === undefined ? "" : `:${target.line}`}`;

    const nvim = terminal();
    fit = new FitAddon();
    nvim.loadAddon(fit);
    nvim.open(viewEl);
    fit.fit();
    nvim.onData(send);
    term = nvim;

    void fetch(`/edit/size?cols=${nvim.cols}&rows=${nvim.rows}`, { method: "POST" }).catch(() => {});
    listen(nvim);
    nvim.focus();
  }

  function listen(nvim: Terminal) {
    stream = new EventSource("/edit");
    stream.addEventListener("out", (e) => nvim.write(decode((e as MessageEvent<string>).data)));
    stream.addEventListener("exit", () => shut());
    stream.addEventListener("error", () => {
      if (stream?.readyState !== EventSource.CLOSED) return;
      shut();
      note("nvim went away");
    });
  }

  function shut() {
    stream?.close();
    stream = null;
    term?.dispose();
    term = null;
    fit = null;
    viewEl.replaceChildren();
    paneEl.dataset.hidden = "";
    up = false;
    restore?.();
    restore = null;
    view.focus();
  }

  function swap() {
    if (paneEl.contains(document.activeElement)) view.focus();
    else term?.focus();
  }

  function take() {
    if (!term) return;
    if (!term.hasSelection()) {
      return note(`nothing selected — ${forceDrag} over the lines you want, then take them`);
    }
    const rows = intoDocument(view, term.getSelection().split("\n"));
    if (rows === null) return note("nothing there to take");
    note(`${rows} line${rows === 1 ? "" : "s"} of ${basename()} taken into the document`);
  }

  function basename(): string {
    return whereEl.textContent?.split("/").pop() ?? "the file";
  }

  let queued = "";
  let sending = false;
  function send(data: string) {
    queued += data;
    if (!sending) void drain();
  }
  async function drain() {
    sending = true;
    while (queued) {
      const body = queued;
      queued = "";
      try {
        await fetch("/edit/in", { method: "POST", body });
      } catch {
      }
    }
    sending = false;
  }

  let sized = "";
  new ResizeObserver(() => {
    if (!term || !fit || !up) return;
    fit.fit();
    const now = `${term.cols}x${term.rows}`;
    if (now === sized) return;
    sized = now;
    void fetch(`/edit/size?cols=${term.cols}&rows=${term.rows}`, { method: "POST" }).catch(() => {});
  }).observe(viewEl);

  dragToResize(paneEl, gripEl);

  window.addEventListener(
    "keydown",
    (e) => {
      if (!up || e.altKey) return;
      if (e.ctrlKey && !e.metaKey && e.code === "Backquote") {
        e.preventDefault();
        e.stopPropagation();
        swap();
      } else if (mac ? e.metaKey && e.key.toLowerCase() === "y" : e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        e.stopPropagation();
        take();
      }
    },
    true,
  );

  paneEl.querySelector("#edit-take")!.addEventListener("click", () => take());
  document.getElementById("edit-keys")!.textContent = mac ? "⌘Y" : "⌃⇧Y";

  return { open: (target) => void open(target) };
}

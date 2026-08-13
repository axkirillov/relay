import type { EditorView } from "@codemirror/view";
import { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

import type { Target } from "./goto";
import { decode, dragToResize, intoDocument, mac, terminal } from "./pane";
import type { Pane } from "./terminal";

const paneEl = document.getElementById("edit")!;
const viewEl = document.getElementById("edit-view")!;
const whereEl = document.getElementById("edit-where")!;
const gripEl = document.getElementById("edit-grip")!;

let up = false;

/**
 * Whether nvim has the pane.
 *
 * The shell pane asks, because `⌃\`` and `⌘Y` are its keys and only one of the
 * two panes can be on screen. Read the other way round it is a runtime cycle,
 * which is why it is this way round.
 */
export function editing(): boolean {
  return up;
}

export type Editor = {
  /** Open the human's own nvim on a path the document was pointing at. */
  open(target: Target): void;
};

/**
 * A real neovim, in the window, on the file under the cursor.
 *
 * Not a preview and not a viewer: it is their nvim, with their config, their
 * LSP and their plugins, on the real file — so they can change it and `:w` it,
 * and that is a consequence of what this is rather than a hole in it. It lives
 * for exactly one file. `:q` is what closes it, the pane goes when the process
 * does, and the document is underneath the whole time with every edit and the
 * cursor exactly where they left them.
 */
export function editorPane(view: EditorView, note: (text: string) => void, shell: Pane): Editor {
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let stream: EventSource | null = null;
  let restore: (() => void) | null = null;

  async function open(target: Target) {
    // While nvim has the pane it has the keys too, `gf` among them — so this is
    // nvim's own `gf` from in there, and never a second one of these.
    if (up) return;
    up = true;

    let answer: Response;
    try {
      answer = await fetch("/edit", { method: "POST", body: JSON.stringify(target) });
    } catch {
      up = false;
      return note("relay is not there any more");
    }
    // Nothing has been shown yet, which is the point of asking before opening:
    // a path that turns out not to be a file costs a line in the footer and no
    // pane flashing open and shut.
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

    // The pty was spawned at a nominal size, because nothing had been laid out
    // to measure when it was asked for. This is the real one, and it arrives
    // while nvim is still reading their config.
    void fetch(`/edit/size?cols=${nvim.cols}&rows=${nvim.rows}`, { method: "POST" }).catch(() => {});
    listen(nvim);
    nvim.focus();
  }

  function listen(nvim: Terminal) {
    stream = new EventSource("/edit");
    stream.addEventListener("out", (e) => nvim.write(decode((e as MessageEvent<string>).data)));
    // Quitting nvim is the whole of the closing gesture: the process ends, the
    // pty ends, and this is that reaching the page. Nothing else puts the pane
    // away, and nothing else has to.
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
    // The shell pane comes back as it was, if it was up at all — but it does not
    // take the caret with it. `gf` was pressed in the document, so the document
    // is where the human is owed back.
    restore?.();
    restore = null;
    view.focus();
  }

  /** Into the file, or back to the document. */
  function swap() {
    if (paneEl.contains(document.activeElement)) view.focus();
    else term?.focus();
  }

  function take() {
    if (!term) return;
    if (!term.hasSelection()) {
      return note("nothing selected — ⇧-drag over the lines you want, then take them");
    }
    const rows = intoDocument(view, term.getSelection().split("\n"));
    if (rows === null) return note("nothing there to take");
    note(`${rows} line${rows === 1 ? "" : "s"} of ${basename()} taken into the document`);
  }

  function basename(): string {
    return whereEl.textContent?.split("/").pop() ?? "the file";
  }

  // One request per burst rather than per keystroke, and never two in flight, so
  // what nvim reads is in the order it was typed.
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
        // The CLI is gone; the stream closing says so on its own.
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

  // Capture phase on window, the same reasoning as the shell pane's: once nvim
  // has focus every key is nvim's — and nvim has uses for far more of them than
  // a shell does — so the two that are not have to be taken before xterm sees
  // them. There is no third: closing this pane is `:q`, which is nvim's word for
  // it and the one already in their hands.
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

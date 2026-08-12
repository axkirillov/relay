import type { EditorView } from "@codemirror/view";
import { Vim } from "@replit/codemirror-vim";
import { FitAddon } from "@xterm/addon-fit";
import { type IBuffer, Terminal } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";
import { fence, insertion, withoutPrompt } from "./take";

const paneEl = document.getElementById("term")!;
const viewEl = document.getElementById("term-view")!;
const whereEl = document.getElementById("term-where")!;
const gripEl = document.getElementById("term-grip")!;

export type Pane = {
  /** Into the shell, or back to the document; opens the pane if it is shut. */
  swap(): void;
  /** Open the pane, or put it away. */
  toggle(): void;
  /** Selection if there is one, the last command and its output otherwise. */
  take(): void;
  open: boolean;
};

/** Whether a key belongs to the shell rather than to the document. */
export function inTerminal(target: EventTarget | null): boolean {
  return target instanceof Node && paneEl.contains(target);
}

const mac = navigator.platform.startsWith("Mac");

/**
 * A real terminal in the window, on a pty in the relay process.
 *
 * The pane is opt-in and goes away again, because the window is a document
 * first: a terminal that was always up would change what relay is. And it is
 * only worth having if what happens in it can reach the agent, which is what
 * `take` is for — see take.ts.
 */
export function terminalPane(view: EditorView, note: (text: string) => void): Pane {
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let stream: EventSource | null = null;
  let dead = false;
  let ran: Ran | null = null;

  const pane: Pane = {
    open: false,
    // Moving the caret out of the shell is not the same as being done with it —
    // the document is often read with a command's output still on screen. So one
    // key crosses between them and another puts the pane away.
    swap() {
      if (!pane.open) return show();
      if (inTerminal(document.activeElement)) view.focus();
      else term?.focus();
    },
    toggle() {
      if (pane.open) hide();
      else show();
    },
    take() {
      if (!term) return note("no terminal open");
      const selected = term.hasSelection();
      const lines = selected ? term.getSelection().split("\n") : lastCommand(term, ran);
      const block = fence(lines);
      if (!block) return note("nothing in the terminal to take");
      const { from, insert } = insertion(view.state.doc.toString(), view.state.selection.main.head, block);
      // The caret ends up under the block, so a second take stacks below the
      // first rather than on top of it.
      view.dispatch({
        changes: { from, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true,
      });
      const rows = block.split("\n").length - 2;
      note(`${rows} line${rows === 1 ? "" : "s"} ${selected ? "taken" : "of the last command taken"} into the document`);
    },
  };

  function show() {
    delete paneEl.dataset.hidden;
    pane.open = true;
    if (term) resize();
    (term ?? start()).focus();
  }

  function hide() {
    paneEl.dataset.hidden = "";
    pane.open = false;
    view.focus();
  }

  function start(): Terminal {
    const shell = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 5000,
      // ⌥B and ⌥F are how a shell moves by words, and on a Mac they are only
      // that if this is on.
      macOptionIsMeta: true,
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
    fit = new FitAddon();
    shell.loadAddon(fit);
    shell.open(viewEl);
    fit.fit();

    shell.onData((data) => {
      if (dead) return restart();
      // Enter is the human running something: the row the cursor stands on now
      // is where that command is written, and everything under it until the next
      // prompt is what it had to say. No shell integration to ask for, and it
      // holds for whatever shell they use.
      if (data.includes("\r")) ran = commandStart(shell.buffer.active);
      send(data);
    });

    // A selection here is a yank: into vim's unnamed register, which is where
    // `p` looks, and on to the system clipboard by the patch main.ts puts on the
    // register controller — the same road a yank in the document takes. Writing
    // the clipboard directly instead would leave `p` with nothing to paste.
    // Debounced, because dragging fires this on every cell crossed.
    let settle = 0;
    shell.onSelectionChange(() => {
      const text = shell.getSelection();
      if (!text) return;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => Vim.getRegisterController().pushText(undefined, "yank", text, false, false), 200);
    });

    term = shell;
    listen(shell);
    return shell;
  }

  function restart() {
    term?.dispose();
    viewEl.replaceChildren();
    term = null;
    dead = false;
    ran = null;
    sized = "";
    start().focus();
  }

  function listen(term: Terminal) {
    stream = new EventSource(`/pty?cols=${term.cols}&rows=${term.rows}`);
    stream.addEventListener("hello", (e) => {
      const { shell, cwd } = JSON.parse((e as MessageEvent<string>).data) as { shell: string; cwd: string };
      whereEl.textContent = `${shell.split("/").pop()} · ${cwd}`;
    });
    stream.addEventListener("out", (e) => term.write(decode((e as MessageEvent<string>).data)));
    stream.addEventListener("exit", (e) => {
      // Without this the browser would reconnect on the closed stream and the
      // server would hand it a brand new shell nobody asked for.
      stream?.close();
      stream = null;
      dead = true;
      const code = (e as MessageEvent<string>).data;
      term.write(`\r\n\x1b[38;5;242m— the shell exited (${code}). What it said is still here to take; any key starts another.\x1b[0m\r\n`);
    });
    // A stream that never opens — no working node-pty on this machine — is the
    // one failure the pane has to explain for itself.
    stream.addEventListener("error", () => {
      if (stream?.readyState !== EventSource.CLOSED || dead) return;
      stream = null;
      dead = true;
      term.write("\r\n\x1b[38;5;210m— no terminal here: relay could not start a shell.\x1b[0m\r\n");
    });
  }

  // One request per burst rather than per keystroke, and never two in flight, so
  // what the shell reads is in the order it was typed.
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
        await fetch("/pty/in", { method: "POST", body });
      } catch {
        // The CLI is gone; the stream closing says so on its own.
      }
    }
    sending = false;
  }

  let sized = "";
  function resize() {
    if (!term || !fit || !pane.open) return;
    fit.fit();
    const now = `${term.cols}x${term.rows}`;
    if (now === sized) return;
    sized = now;
    void fetch(`/pty/size?cols=${term.cols}&rows=${term.rows}`, { method: "POST" }).catch(() => {});
  }

  drag();
  new ResizeObserver(() => resize()).observe(viewEl);

  /** The pane's height is the human's business — a rebase needs more of it. */
  function drag() {
    gripEl.addEventListener("pointerdown", (down: PointerEvent) => {
      down.preventDefault();
      gripEl.setPointerCapture(down.pointerId);
      const startY = down.clientY;
      const startH = paneEl.offsetHeight;
      const move = (at: PointerEvent) => {
        const height = Math.min(Math.max(startH - (at.clientY - startY), 120), window.innerHeight - 160);
        paneEl.style.height = `${height}px`;
      };
      const up = () => {
        gripEl.removeEventListener("pointermove", move);
        gripEl.removeEventListener("pointerup", up);
      };
      gripEl.addEventListener("pointermove", move);
      gripEl.addEventListener("pointerup", up);
    });
  }

  // Capture phase on window, the same reasoning as ⌃X in main.ts: once the
  // terminal has focus every key is the shell's, so the two that are not have to
  // be taken before xterm sees them.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === "Backquote") {
        e.preventDefault();
        e.stopPropagation();
        pane.swap();
      } else if (mac ? e.metaKey && e.key.toLowerCase() === "y" : e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        e.stopPropagation();
        pane.take();
      }
    },
    true,
  );

  paneEl.querySelector("#term-close")!.addEventListener("click", () => hide());
  paneEl.querySelector("#term-take")!.addEventListener("click", () => pane.take());
  whereEl.textContent = "";
  document.getElementById("term-keys")!.textContent = mac ? "⌘Y" : "⌃⇧Y";

  return pane;
}

/**
 * The rows the last command and its output occupy.
 *
 * Read off the terminal's own buffer rather than the byte stream, which is the
 * point: what comes back is what the human can see — wrapping resolved, escapes
 * gone, a TUI's redraws collapsed into the screen it settled on.
 */
function lastCommand(term: Terminal, ran: Ran | null): string[] {
  const buffer = term.buffer.active;
  // A full-screen program has no scrollback to walk back through, and its screen
  // is the whole of what it has to say.
  const alt = buffer.type === "alternate";
  const from = alt ? 0 : (ran?.row ?? buffer.baseY);
  // The row the cursor is on is the prompt the shell has drawn since, so it is
  // not part of what ran.
  const to = alt ? term.rows : buffer.baseY + buffer.cursorY;

  const lines = rows(buffer, from, Math.max(to, from + 1));
  return alt || !ran ? lines : withoutPrompt(lines, ran.prompt);
}

/** What the human ran, and the prompt they ran it under. */
type Ran = { row: number; prompt: string[] };

/**
 * Where the command the cursor is on starts, and what stood above it — a prompt
 * of more than one line is the rest of what stood there, and withoutPrompt needs
 * it to recognise the next one.
 */
function commandStart(buffer: IBuffer): Ran {
  let row = buffer.baseY + buffer.cursorY;
  // A command long enough to wrap begins on an earlier row than the cursor's.
  while (row > 0 && buffer.getLine(row)?.isWrapped) row--;
  return { row, prompt: rows(buffer, Math.max(0, row - 3), row) };
}

function rows(buffer: IBuffer, from: number, to: number): string[] {
  const lines: string[] = [];
  for (let y = from; y < to; y++) lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  return lines;
}

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

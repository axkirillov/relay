import type { EditorView } from "@codemirror/view";
import { Vim } from "@replit/codemirror-vim";
import { FitAddon } from "@xterm/addon-fit";
import type { IBuffer, Terminal } from "@xterm/xterm";

import { editing } from "./editor";
import { decode, dragToResize, intoDocument, mac, terminal } from "./pane";
import { withoutPrompt } from "./take";

const paneEl = document.getElementById("term")!;
const viewEl = document.getElementById("term-view")!;
const whereEl = document.getElementById("term-where")!;
const gripEl = document.getElementById("term-grip")!;

export type Pane = {
  swap(): void;
  toggle(): void;
  take(): void;
  stepAside(): () => void;
  open: boolean;
};

export function inTerminal(target: EventTarget | null): boolean {
  return target instanceof Node && paneEl.contains(target);
}

export function terminalPane(view: EditorView, note: (text: string) => void): Pane {
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let stream: EventSource | null = null;
  let dead = false;
  let ran: Ran | null = null;

  const pane: Pane = {
    open: false,
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
      const rows = intoDocument(view, selected ? term.getSelection().split("\n") : lastCommand(term, ran));
      if (rows === null) return note("nothing in the terminal to take");
      note(`${rows} line${rows === 1 ? "" : "s"} ${selected ? "taken" : "of the last command taken"} into the document`);
    },
    stepAside() {
      const was = pane.open;
      if (was) paneEl.dataset.hidden = "";
      return () => {
        if (!was) return;
        delete paneEl.dataset.hidden;
        resize();
      };
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
    const shell = terminal();
    fit = new FitAddon();
    shell.loadAddon(fit);
    shell.open(viewEl);
    fit.fit();

    shell.onData((data) => {
      if (dead) return restart();
      if (data.includes("\r")) ran = commandStart(shell.buffer.active);
      send(data);
    });

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
      const { program, cwd } = JSON.parse((e as MessageEvent<string>).data) as { program: string; cwd: string };
      whereEl.textContent = `${program.split("/").pop()} · ${cwd}`;
    });
    stream.addEventListener("out", (e) => term.write(decode((e as MessageEvent<string>).data)));
    stream.addEventListener("exit", (e) => {
      stream?.close();
      stream = null;
      dead = true;
      const code = (e as MessageEvent<string>).data;
      term.write(`\r\n\x1b[38;5;242m— the shell exited (${code}). What it said is still here to take; any key starts another.\x1b[0m\r\n`);
    });
    stream.addEventListener("error", () => {
      if (stream?.readyState !== EventSource.CLOSED || dead) return;
      stream = null;
      dead = true;
      term.write("\r\n\x1b[38;5;210m— no terminal here: relay could not start a shell.\x1b[0m\r\n");
    });
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
        await fetch("/pty/in", { method: "POST", body });
      } catch {
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

  dragToResize(paneEl, gripEl);
  new ResizeObserver(() => resize()).observe(viewEl);

  window.addEventListener(
    "keydown",
    (e) => {
      if (editing()) return;
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

function lastCommand(term: Terminal, ran: Ran | null): string[] {
  const buffer = term.buffer.active;
  const alt = buffer.type === "alternate";
  const from = alt ? 0 : (ran?.row ?? buffer.baseY);
  const to = alt ? term.rows : buffer.baseY + buffer.cursorY;

  const lines = rows(buffer, from, Math.max(to, from + 1));
  return alt || !ran ? lines : withoutPrompt(lines, ran.prompt);
}

type Ran = { row: number; prompt: string[] };

function commandStart(buffer: IBuffer): Ran {
  let row = buffer.baseY + buffer.cursorY;
  while (row > 0 && buffer.getLine(row)?.isWrapped) row--;
  return { row, prompt: rows(buffer, Math.max(0, row - 3), row) };
}

function rows(buffer: IBuffer, from: number, to: number): string[] {
  const lines: string[] = [];
  for (let y = from; y < to; y++) lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  return lines;
}

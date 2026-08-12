import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { getCM, Vim, vim } from "@replit/codemirror-vim";

import { liveDiff, type Stats } from "./livediff";
import { isRendering, renderBlocks, setRendering } from "./render";
import { restore } from "./restore";
import { markdownHighlight, theme } from "./theme";

const mount = document.getElementById("editor")!;
const statsEl = document.getElementById("stats")!;
const modeEl = document.getElementById("mode")!;
const noteEl = document.getElementById("note")!;
const overlayEl = document.getElementById("overlay")!;

let view: EditorView;
let sending = false;

function overlay(mark: string, title: string, note: string, tone: "ok" | "error" = "ok") {
  overlayEl.querySelector(".mark")!.textContent = mark;
  overlayEl.querySelector(".title")!.textContent = title;
  overlayEl.querySelector(".note")!.textContent = note;
  overlayEl.dataset.tone = tone;
  overlayEl.dataset.show = "";
}

function hideOverlay() {
  delete overlayEl.dataset.show;
}

function showMode(mode: string, subMode?: string) {
  const label = mode === "visual" ? `VISUAL${subMode === "linewise" ? " LINE" : subMode === "blockwise" ? " BLOCK" : ""}` : mode.toUpperCase();
  modeEl.textContent = label;
  modeEl.className = mode === "insert" ? "insert" : mode === "visual" ? "visual" : "";
}

let noteTimer = 0;
function note(text: string) {
  noteEl.textContent = text;
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => (noteEl.textContent = ""), 4000);
}

function showStats(s: Stats) {
  if (!s.added && !s.removed) {
    statsEl.textContent = "unchanged";
    return;
  }
  statsEl.innerHTML =
    `<span class="add">+${s.added}</span> <span class="del">−${s.removed}</span> ` +
    `<span>edit${s.added + s.removed === 1 ? "" : "s"}</span>`;
}

async function accept() {
  if (sending) return;
  sending = true;
  overlay("↑", "Sending", "handing your reply to the agent…");
  try {
    const res = await fetch("/accept", {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: view.state.doc.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    overlay("✓", "Accepted", "the agent has your reply — this window is closing");
    // If the CLI is gone the window will not be closed for us; say so rather
    // than leaving a lie on screen.
    setTimeout(() => {
      overlay("✓", "Accepted", "the agent has your reply — you can close this window now");
    }, 3000);
  } catch (err) {
    sending = false;
    overlay("!", "Could not send", `${err}. Click to go back and try again.`, "error");
    overlayEl.addEventListener("click", hideOverlay, { once: true });
  }
}

function bindVim(original: string) {
  Vim.defineEx("accept", "acc", () => void accept());
  Vim.defineEx("write", "w", () => void accept());
  Vim.defineEx("wq", "wq", () => void accept());
  Vim.defineEx("xit", "x", () => void accept());
  Vim.defineEx("quit", "q", () => window.close());

  // Vim leaves visual mode before an ex command runs, so the editor's own
  // selection is already gone by now; the range vim parsed off the command line
  // is what is left, and it covers `'<,'>` from visual mode, an explicit
  // `:1,4res`, and the cursor line in normal mode alike.
  Vim.defineEx("restore", "res", (_cm, params) => {
    const cursor = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
    const from = params.selectionLine ?? cursor;
    const to = params.selectionLineEnd ?? from;
    note(restore(view, original, from, to) ? "restored" : "nothing to restore");
  });

  // One toggle rather than an on and an off command: `:ren` would be a prefix
  // away from `:res` on the command line.
  Vim.defineEx("raw", "raw", () => {
    const on = !isRendering(view.state);
    view.dispatch({ effects: setRendering.of(on) });
    note(on ? "rendered" : "source");
  });

  Vim.defineAction("relayAccept", () => void accept());
  Vim.mapCommand("ZZ", "action", "relayAccept", {}, { context: "normal" });
}

async function boot() {
  const [original, start] = await Promise.all([
    fetch("/doc").then((r) => r.text()),
    fetch("/prefill").then((r) => r.text()),
  ]);
  bindVim(original);

  view = new EditorView({
    parent: mount,
    state: EditorState.create({
      doc: start,
      extensions: [
        vim(),
        history(),
        lineNumbers(),
        drawSelection(),
        highlightSpecialChars(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        markdownHighlight,
        theme,
        renderBlocks(original),
        liveDiff(original, showStats),
        keymap.of([...historyKeymap, ...defaultKeymap]),
      ],
    }),
  });

  view.focus();
  getCM(view)?.on("vim-mode-change", (e: { mode: string; subMode?: string }) =>
    showMode(e.mode, e.subMode),
  );
  document.getElementById("accept")!.addEventListener("click", () => void accept());

  // Capture phase on window, not a CodeMirror keymap: the vim extension handles
  // keys from a ViewPlugin keydown handler, which runs before the keymap facet,
  // so even Prec.highest lost ⌃X in normal mode. Capturing at the window beats
  // both, in every mode.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        e.stopPropagation();
        void accept();
      }
    },
    true,
  );
}

void boot();

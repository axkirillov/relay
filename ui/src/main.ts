import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightSpecialChars, keymap } from "@codemirror/view";
import { Vim, vim } from "@replit/codemirror-vim";

import { liveDiff, type Stats } from "./livediff";
import { markdownHighlight, theme } from "./theme";

const mount = document.getElementById("editor")!;
const statsEl = document.getElementById("stats")!;
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

function bindVim() {
  Vim.defineEx("accept", "acc", () => void accept());
  Vim.defineEx("write", "w", () => void accept());
  Vim.defineEx("wq", "wq", () => void accept());
  Vim.defineEx("xit", "x", () => void accept());
  Vim.defineEx("quit", "q", () => window.close());

  Vim.defineAction("relayAccept", () => void accept());
  Vim.mapCommand("ZZ", "action", "relayAccept", {}, { context: "normal" });
}

async function boot() {
  const [original, start] = await Promise.all([
    fetch("/doc").then((r) => r.text()),
    fetch("/prefill").then((r) => r.text()),
  ]);
  bindVim();

  view = new EditorView({
    parent: mount,
    state: EditorState.create({
      doc: start,
      extensions: [
        vim(),
        history(),
        drawSelection(),
        highlightSpecialChars(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        markdownHighlight,
        theme,
        liveDiff(original, showStats),
        keymap.of([...historyKeymap, ...defaultKeymap]),
      ],
    }),
  });

  view.focus();
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

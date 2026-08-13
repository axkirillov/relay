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

import { type Editor, editorPane } from "./editor";
import { fenceBackground } from "./fence";
import { pathAt, target } from "./goto";
import { codeLanguage } from "./languages";
import { liveDiff, type Stats } from "./livediff";
import { foldOutput, opened, refold } from "./outfold";
import { inPane } from "./pane";
import { type Images, isRendering, renderBlocks, setRendering } from "./render";
import { restore } from "./restore";
import { setSink, shellBlockAt, sink, startOutput } from "./runblock";
import { type Pane, terminalPane } from "./terminal";
import { markdownHighlight, theme } from "./theme";

const mount = document.getElementById("editor")!;
const statsEl = document.getElementById("stats")!;
const modeEl = document.getElementById("mode")!;
const noteEl = document.getElementById("note")!;
const overlayEl = document.getElementById("overlay")!;

let view: EditorView;
let pane: Pane;
let editor: Editor;
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
/** What the footer goes back to saying — a command in flight outlasts a remark. */
let holding = "";

function note(text: string) {
  noteEl.textContent = text;
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => (noteEl.textContent = holding), 4000);
}

function hold(text: string) {
  holding = text;
  noteEl.textContent = text;
  window.clearTimeout(noteTimer);
}

function release() {
  holding = "";
  noteEl.textContent = "";
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

/** The command in flight, if there is one; aborting it is the human's ⌃C. */
let job: AbortController | null = null;

/**
 * Run the shell block the cursor is in, and write its output into the document.
 *
 * The output has to be document text, because the diff is the only thing the
 * agent gets back — it asked for the command because it wants the answer. So
 * output lands under the command as an ordinary fenced block, the human can edit
 * or delete it like anything else, and accepting sends it.
 */
async function runAtCursor() {
  if (job) return note("something is already running — ⌃C stops it");

  const block = shellBlockAt(view.state, view.state.selection.main.head);
  if (!block) return note("no command here — put the cursor in a ```sh block");

  const plan = startOutput(view.state, block);
  view.dispatch({
    changes: { from: plan.from, to: plan.to, insert: plan.insert },
    effects: setSink.of(plan.at),
  });

  const first = block.command.split("\n")[0]!;
  hold(`running ${first}${block.command.includes("\n") ? " …" : ""} — ⌃C stops it`);

  job = new AbortController();
  let wrote = false;
  try {
    const res = await fetch("/run", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: block.command,
      signal: job.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    // Whole lines only. The closing fence sits directly below the last line of
    // output, so writing half a line would put the fence on the end of it — and
    // an unterminated block is not a block the fold or the agent can read.
    let partial = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      partial += decoder.decode(value, { stream: true });
      const cut = partial.lastIndexOf("\n");
      if (cut < 0) continue;
      wrote = append(partial.slice(0, cut + 1)) || wrote;
      partial = partial.slice(cut + 1);
    }
    if (partial) wrote = append(`${partial}\n`) || wrote;
    if (!wrote) append("[no output]\n");
  } catch (err) {
    // The stop was ours, so the server's own last word went nowhere: say it here.
    if (err instanceof DOMException && err.name === "AbortError") append("[stopped]\n");
    else append(`relay could not run it: ${err}\n`);
  } finally {
    job = null;
    release();
    view.dispatch({ effects: setSink.of(null) });
  }
}

/** Output goes where the sink is now — which is not where it was a keystroke ago. */
function append(text: string): boolean {
  const at = view.state.field(sink);
  if (at === null) return false;
  view.dispatch({ changes: { from: at, insert: text } });
  return true;
}

/**
 * `gf` — follow the path under the cursor into the human's own nvim.
 *
 * A relay document is full of `src/cli.ts:42`, and until now every one of them
 * was a thing to go and look at somewhere else. In visual mode the selection is
 * the path, which is the way out of a name this cannot pick out of prose.
 */
function gotoFile() {
  const { state } = view;
  const at = state.selection.main;
  const line = state.doc.lineAt(at.head);
  const found = at.empty
    ? pathAt(line.text, at.head - line.from)
    : target(state.sliceDoc(at.from, at.to).trim());
  if (!found) return note("no path under the cursor");
  editor.open(found);
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

  Vim.defineEx("terminal", "term", () => pane.toggle());
  Vim.defineEx("take", "take", () => pane.take());

  // `:run` rather than `:r`, which is vim's own read.
  Vim.defineEx("run", "run", () => void runAtCursor());

  // Opening a fold is a click; closing it again has to be said, so it is said
  // both ways — `:fold` next to `:raw` and `:res`, and `zc`, which is what a vim
  // user's fingers will try first.
  const foldBack = () => note(refold(view) ? "folded" : "nothing to fold");
  Vim.defineEx("fold", "fo", foldBack);
  Vim.defineAction("relayFold", foldBack);
  Vim.mapCommand("zc", "action", "relayFold", {}, { context: "normal" });


  Vim.defineAction("relayAccept", () => void accept());
  Vim.mapCommand("ZZ", "action", "relayAccept", {}, { context: "normal" });

  // `gF` alongside `gf`: vim splits the line off between the two, this does not,
  // and a hand that has learnt either should not have to remember which.
  Vim.defineAction("relayGotoFile", () => gotoFile());
  for (const keys of ["gf", "gF"]) {
    Vim.mapCommand(keys, "action", "relayGotoFile", {}, { context: "normal" });
    Vim.mapCommand(keys, "action", "relayGotoFile", {}, { context: "visual" });
  }

  copyToClipboard();
}

/**
 * What vim takes, the system clipboard gets — vim's own `clipboard=unnamed`.
 *
 * The registers live inside this page and die with it, so a line yanked to quote
 * somewhere else was going nowhere. Rather than reimplement the operators, this
 * hooks the register controller: yank, delete and change are the only three that
 * reach its pushText, and it is handed the name of the one that got it there, so
 * a yank can still be told from a cut when there is something to say about it.
 * The controller is built once, when the vim module loads, so patching the
 * instance holds for as long as the window is up.
 */
function copyToClipboard() {
  const registers = Vim.getRegisterController();
  const push = registers.pushText.bind(registers);

  registers.pushText = (name, operator, text, linewise, blockwise) => {
    push(name, operator, text, linewise, blockwise);
    // `"_` is vim's black hole — what goes into it goes nowhere.
    if (name === "_" || !text) return;
    // Linewise, it carries its newline the way the register's own copy does, so
    // pasting it elsewhere lands a line rather than a fragment.
    const copied = linewise && !text.endsWith("\n") ? `${text}\n` : text;
    void navigator.clipboard.writeText(copied).then(
      () => note(took(operator, copied)),
      () => note("the clipboard refused it"),
    );
  };
}

function took(operator: string, text: string): string {
  const verb = operator === "yank" ? "yanked" : "cut";
  const lines = text.replace(/\n$/, "").split("\n").length;
  return lines > 1 ? `${lines} lines ${verb} to the clipboard` : `${verb} to the clipboard`;
}

async function boot() {
  const [original, start, images] = await Promise.all([
    fetch("/doc").then((r) => r.text()),
    fetch("/prefill").then((r) => r.text()),
    // Where the local pictures are, if there are any. An old server without the
    // route is no reason not to open the document.
    fetch("/local").then((r) => (r.ok ? (r.json() as Promise<Images>) : {})),
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
        markdown({ base: markdownLanguage, codeLanguages: codeLanguage }),
        markdownHighlight,
        fenceBackground,
        theme,
        renderBlocks(original, images),
        foldOutput(),
        sink,
        liveDiff(original, showStats),
        // The way back is not on screen once the notice is gone, so it is said at
        // the one moment it is wanted.
        EditorView.updateListener.of((u) => {
          if (u.transactions.some(opened)) note("opened — :fold, or zc, puts it back");
        }),
        keymap.of([...historyKeymap, ...defaultKeymap]),
      ],
    }),
  });

  view.focus();
  pane = terminalPane(view, note);
  editor = editorPane(view, note, pane);
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
      // ⌃X and ⌃↵ are keys a shell has its own uses for, and nvim has uses for
      // more of them still. Inside either pane every key belongs to the child
      // process — accepting or running from there would be relay reaching over
      // the human's hands.
      if (inPane(e.target)) return;
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();

      if (key === "x") {
        e.preventDefault();
        e.stopPropagation();
        void accept();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        void runAtCursor();
        return;
      }
      // Only while something is running — otherwise ⌃C is vim's, where it stands
      // in for Esc.
      if (key === "c" && job) {
        e.preventDefault();
        e.stopPropagation();
        job.abort();
      }
    },
    true,
  );
}

void boot();

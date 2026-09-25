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

import { stillRunningNotice } from "../../src/spill";
import { drawDiagrams } from "./diagram";
import { diffReview, reviewNumber } from "./diffview";
import { type Editor, editorPane } from "./editor";
import { fenceBackground } from "./fence";
import { pathAt, target } from "./goto";
import { codeLanguage } from "./languages";
import { url, urlAt } from "./link";
import { liveDiff, type Stats } from "./livediff";
import { foldOutput, opened, refold } from "./outfold";
import { inPane } from "./pane";
import { followRendered, type Images, isRendering, renderBlocks, selectWords, setRendering } from "./render";
import { restore } from "./restore";
import { setSink, shellBlockAt, sink, startOutput } from "./runblock";
import { type Pane, terminalPane } from "./terminal";
import { markdownHighlight, theme } from "./theme";

const mount = document.getElementById("editor")!;
const statsEl = document.getElementById("stats")!;
const modeEl = document.getElementById("mode")!;
const queueEl = document.getElementById("queue")!;
const noteEl = document.getElementById("note")!;
const overlayEl = document.getElementById("overlay")!;

const reading = document.body.dataset.read !== undefined;

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

function watchQueue() {
  const read = async () => {
    try {
      const { waiting } = (await fetch("/queue").then((r) => r.json())) as { waiting: number };
      queueEl.textContent = waiting > 0 ? `${waiting} more waiting` : "";
    } catch {
      queueEl.textContent = "";
    }
  };
  void read();
  window.setInterval(() => void read(), 1000);
}

async function accept() {
  if (sending) return;
  if (job && jobLog) append(`${jobWrote ? "\n" : ""}${stillRunningNotice(jobLog)}\n`);
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
    setTimeout(() => {
      overlay("✓", "Accepted", "the agent has your reply — you can close this window now");
    }, 3000);
  } catch (err) {
    sending = false;
    overlay("!", "Could not send", `${err}. Click to go back and try again.`, "error");
    overlayEl.addEventListener("click", hideOverlay, { once: true });
  }
}

let saved = "";
let draftTimer = 0;

async function saveDraft(): Promise<void> {
  window.clearTimeout(draftTimer);
  const text = view.state.doc.toString();
  if (text === saved) return;
  const res = await fetch("/draft", {
    method: "POST",
    headers: { "Content-Type": "text/markdown" },
    body: text,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  saved = text;
}

function saveSoon() {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => void saveDraft().catch(() => {}), 400);
}

let job: AbortController | null = null;
let jobLog: string | null = null;
let jobWrote = false;

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
  hold(
    `running ${first}${block.command.includes("\n") ? " …" : ""} — ⌃C stops it, accepting does not`,
  );

  job = new AbortController();
  jobWrote = false;
  try {
    const res = await fetch(`/run?lines=${screenLines()}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: block.command,
      signal: job.signal,
    });
    if (!res.ok) {
      append(`${(await res.text()).trim() || `relay could not run it: HTTP ${res.status}`}\n`);
      return;
    }
    if (!res.body) throw new Error(`HTTP ${res.status}`);
    jobLog = decodeURIComponent(res.headers.get("X-Relay-Log") ?? "") || null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let partial = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      partial += decoder.decode(value, { stream: true });
      const cut = partial.lastIndexOf("\n");
      if (cut < 0) continue;
      jobWrote = append(partial.slice(0, cut + 1)) || jobWrote;
      partial = partial.slice(cut + 1);
    }
    if (partial) jobWrote = append(`${partial}\n`) || jobWrote;
    if (!jobWrote) append("[no output]\n");
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") append("[stopped]\n");
    else append(`relay could not run it: ${err}\n`);
  } finally {
    job = null;
    jobLog = null;
    release();
    view.dispatch({ effects: setSink.of(null) });
  }
}

function screenLines(): number {
  return Math.max(1, Math.floor(window.innerHeight / view.defaultLineHeight));
}

function append(text: string): boolean {
  const at = view.state.field(sink);
  if (at === null) return false;
  view.dispatch({ changes: { from: at, insert: text } });
  return true;
}

function gotoFile() {
  const { state } = view;
  const at = state.selection.main;
  const line = state.doc.lineAt(at.head);
  const found = at.empty
    ? pathAt(line.text, at.head - line.from)
    : target(state.sliceDoc(at.from, at.to).trim());
  if (!found) return note("no path under the cursor");
  if (url(found.path)) return note("that is a link — gx opens it");
  editor.open(found);
}

async function openLink() {
  const { state } = view;
  const at = state.selection.main;
  const line = state.doc.lineAt(at.head);
  const found = at.empty
    ? urlAt(line.text, at.head - line.from)
    : urlAt(state.sliceDoc(at.from, at.to), 0);
  if (!found) return note("no link under the cursor");
  await open(found);
}

async function open(href: string) {
  const link = url(href);
  if (!link) return note(`not a link relay will open — ${href}`);

  try {
    const answer = await fetch("/open", { method: "POST", body: link });
    if (!answer.ok) return note(await answer.text());
  } catch {
    return note("relay is not there any more");
  }
  note(`opened ${link}`);
}

function bindVim(original: string) {
  if (!reading) {
    Vim.defineEx("accept", "acc", () => void accept());
    Vim.defineEx("write", "w", () => void accept());
    Vim.defineEx("wq", "wq", () => void accept());
    Vim.defineEx("xit", "x", () => void accept());
  }
  Vim.defineEx("quit", "q", () => window.close());

  Vim.defineEx("restore", "res", (_cm, params) => {
    const cursor = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
    const from = params.selectionLine ?? cursor;
    const to = params.selectionLineEnd ?? from;
    note(restore(view, original, from, to) ? "restored" : "nothing to restore");
  });

  Vim.defineEx("raw", "raw", () => {
    const on = !isRendering(view.state);
    view.dispatch({ effects: setRendering.of(on) });
    note(on ? "rendered" : "source");
  });

  Vim.defineEx("terminal", "term", () => pane.toggle());
  Vim.defineEx("take", "take", () => pane.take());

  Vim.defineEx("run", "run", () => void runAtCursor());

  const foldBack = () => note(refold(view) ? "folded" : "nothing to fold");
  Vim.defineEx("fold", "fo", foldBack);
  Vim.defineAction("relayFold", foldBack);
  Vim.mapCommand("zc", "action", "relayFold", {}, { context: "normal" });

  if (!reading) {
    Vim.defineAction("relayAccept", () => void accept());
    Vim.mapCommand("ZZ", "action", "relayAccept", {}, { context: "normal" });
  }

  Vim.defineAction("relayGotoFile", () => gotoFile());
  for (const keys of ["gf", "gF"]) {
    Vim.mapCommand(keys, "action", "relayGotoFile", {}, { context: "normal" });
    Vim.mapCommand(keys, "action", "relayGotoFile", {}, { context: "visual" });
  }

  Vim.defineAction("relayOpenLink", () => void openLink());
  Vim.mapCommand("gx", "action", "relayOpenLink", {}, { context: "normal" });
  Vim.mapCommand("gx", "action", "relayOpenLink", {}, { context: "visual" });

  copyToClipboard();
}

function copyToClipboard() {
  const registers = Vim.getRegisterController();
  const push = registers.pushText.bind(registers);

  registers.pushText = (name, operator, text, linewise, blockwise) => {
    push(name, operator, text, linewise, blockwise);
    if (name === "_" || !text) return;
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
    fetch("/local").then((r) => (r.ok ? (r.json() as Promise<Images>) : {})),
  ]);
  const diagrams = await drawDiagrams(original);
  bindVim(original);
  saved = start;

  view = new EditorView({
    parent: mount,
    state: EditorState.create({
      doc: start,
      extensions: [
        vim(),
        reading ? EditorState.readOnly.of(true) : [],
        history(),
        lineNumbers({ formatNumber: (n, state) => reviewNumber(state, n) ?? String(n) }),
        drawSelection(),
        highlightSpecialChars(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: codeLanguage }),
        markdownHighlight,
        fenceBackground,
        diffReview(),
        theme,
        renderBlocks(original, images, diagrams),
        followRendered(open),
        selectWords(),
        foldOutput(),
        sink,
        liveDiff(original, showStats),
        EditorView.updateListener.of((u) => {
          if (u.transactions.some(opened)) note("opened — :fold, or zc, puts it back");
          if (u.docChanged && !reading) saveSoon();
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
  if (!reading) document.getElementById("accept")!.addEventListener("click", () => void accept());

  window.addEventListener(
    "keydown",
    (e) => {
      if (inPane(e.target)) return;
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();

      if (key === "x" && !reading) {
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
      if (key === "c" && job) {
        e.preventDefault();
        e.stopPropagation();
        job.abort();
      }
    },
    true,
  );

  watchQueue();

  window.addEventListener("pagehide", () => {
    if (sending || reading) return;
    const text = view.state.doc.toString();
    if (text === saved) return;
    navigator.sendBeacon("/draft", new Blob([text], { type: "text/markdown" }));
  });
}

void boot();

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
import { queueAfter } from "./runqueue";
import { type Pane, terminalPane } from "./terminal";
import { markdownHighlight, theme } from "./theme";

const mount = document.getElementById("editor")!;
const statsEl = document.getElementById("stats")!;
const modeEl = document.getElementById("mode")!;
const queueEl = document.getElementById("queue")!;
const noteEl = document.getElementById("note")!;
const overlayEl = document.getElementById("overlay")!;
const choiceEl = document.getElementById("run-choice")!;

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
  sending = true;
  const waiting = [...pending.values()];
  overlay("↑", "Sending", "handing your reply to the agent…");
  try {
    if (waiting.length) {
      const report = await fetch("/run/report").then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      });
      for (const item of waiting) append(item.id, `… queued when this was sent — results will be in ${report}\n`);
    }
    for (const run of active.values()) {
      if (run.log) append(run.id, `${run.wrote ? "\n" : ""}${stillRunningNotice(run.log)}\n`);
    }
    const res = await fetch("/accept", {
      method: "POST",
      headers: { "Content-Type": "application/vnd.relay.accept+json" },
      body: JSON.stringify({ doc: view.state.doc.toString(), waiting, finished: Object.fromEntries(finished) }),
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

type Run = { id: number; controller: AbortController; log: string | null; wrote: boolean };
const active = new Map<number, Run>();
const inFlight = new Map<number, Promise<boolean>>();
const pending = new Map<number, { id: number; command: string; previous: number }>();
const finished = new Map<number, boolean>();
let nextRun = 0;
let tail: Promise<boolean> | null = null;
let tailId: number | null = null;

function chooseRun(command: string): Promise<"queue" | "parallel" | "cancel"> {
  return new Promise((resolve) => {
    choiceEl.dataset.show = "";
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    choiceEl.querySelector("#run-preview")!.textContent = `$ ${command.split("\n")[0]}`;
    const buttons = choiceEl.querySelectorAll<HTMLButtonElement>("button[data-choice]");
    buttons[0]!.focus();
    const finish = (choice: "queue" | "parallel" | "cancel") => {
      delete choiceEl.dataset.show;
      for (const button of buttons) button.removeEventListener("click", click);
      window.removeEventListener("keydown", keydown, true);
      previous?.focus();
      resolve(choice);
    };
    const click = (e: Event) => finish((e.currentTarget as HTMLButtonElement).dataset.choice as "queue" | "parallel" | "cancel");
    const keydown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "escape") finish("cancel");
      else if (!e.metaKey && !e.ctrlKey && !e.altKey && key === "q") finish("queue");
      else if (!e.metaKey && !e.ctrlKey && !e.altKey && key === "p") finish("parallel");
      else if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
        buttons[document.activeElement === buttons[0] ? 1 : 0]!.focus();
      } else if (key === "tab") {
        buttons[document.activeElement === buttons[0] ? 1 : 0]!.focus();
      } else if (key === "enter" || key === " ") return;
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    for (const button of buttons) button.addEventListener("click", click);
    window.addEventListener("keydown", keydown, true);
  });
}

async function runAtCursor() {
  if (choiceEl.dataset.show !== undefined) return;
  const block = shellBlockAt(view.state, view.state.selection.main.head);
  if (!block) return note("no command here — put the cursor in a ```sh block");
  const predecessorId = tail ? tailId : [...inFlight.keys()].at(-1) ?? null;
  const predecessor = predecessorId === null ? null : inFlight.get(predecessorId) ?? null;
  const choice = predecessor ? await chooseRun(block.command) : "parallel";
  if (choice === "cancel" || sending) return;

  const id = ++nextRun;
  const plan = startOutput(view.state, block);
  view.dispatch({
    changes: { from: plan.from, to: plan.to, insert: plan.insert },
    effects: setSink.of({ id, at: plan.at }),
  });

  const first = block.command.split("\n")[0]!;
  const label = `${first}${block.command.includes("\n") ? " …" : ""}`;
  if (choice === "queue" && predecessorId !== null) {
    note(`queued ${label}`);
    pending.set(id, { id, command: block.command, previous: predecessorId });
  }
  const task = choice === "queue" && predecessor
    ? queueAfter(predecessor.then((success) => success && !sending), () => execute(id, block.command, label), () => {
        pending.delete(id);
        if (!sending) append(id, "[skipped — previous command failed or was stopped]\n");
        view.dispatch({ effects: setSink.of({ id, at: null }) });
      })
    : execute(id, block.command, label);
  tail = task;
  tailId = id;
  inFlight.set(id, task);
  void task.then((success) => {
    finished.set(id, success);
    inFlight.delete(id);
    if (tail === task) {
      tail = null;
      tailId = null;
    }
  });
}

async function execute(id: number, command: string, label: string): Promise<boolean> {
  pending.delete(id);
  const run: Run = { id, controller: new AbortController(), log: null, wrote: false };
  active.set(id, run);
  hold(`running ${label} — ⌃C stops the latest run, accepting does not`);
  try {
    const res = await fetch(`/run?lines=${screenLines()}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Relay-Client": String(id) },
      body: command,
      signal: run.controller.signal,
    });
    if (!res.ok) {
      append(id, `${(await res.text()).trim() || `relay could not run it: HTTP ${res.status}`}\n`);
      return false;
    }
    if (!res.body) throw new Error(`HTTP ${res.status}`);
    run.log = decodeURIComponent(res.headers.get("X-Relay-Log") ?? "") || null;
    const remoteId = res.headers.get("X-Relay-Run");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let partial = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      partial += decoder.decode(value, { stream: true });
      const cut = partial.lastIndexOf("\n");
      if (cut < 0) continue;
      run.wrote = append(id, partial.slice(0, cut + 1)) || run.wrote;
      partial = partial.slice(cut + 1);
    }
    partial += decoder.decode();
    if (partial) run.wrote = append(id, `${partial}\n`) || run.wrote;
    if (!run.wrote) append(id, "[no output]\n");
    if (!remoteId) return false;
    const status = await fetch(`/run/status?id=${encodeURIComponent(remoteId)}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ status: number | null }>;
    });
    return status.status === 0;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") append(id, "[stopped]\n");
    else append(id, `relay could not run it: ${err}\n`);
    return false;
  } finally {
    active.delete(id);
    if (!active.size) release();
    view.dispatch({ effects: setSink.of({ id, at: null }) });
  }
}

function screenLines(): number {
  return Math.max(1, Math.floor(window.innerHeight / view.defaultLineHeight));
}

function append(id: number, text: string): boolean {
  const at = view.state.field(sink).get(id);
  if (at === undefined) return false;
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
      if (key === "c" && active.size) {
        e.preventDefault();
        e.stopPropagation();
        [...active.values()].at(-1)!.controller.abort();
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

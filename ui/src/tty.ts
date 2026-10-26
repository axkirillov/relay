import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { FitAddon } from "@xterm/addon-fit";
import { type IBuffer, Terminal } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";
import { shellBlockAt, startOutput } from "./runblock";
import { beginRun, blockRuns, type RunPhase, updateRun } from "./runstatus";
import { type Ended, outputBody, overflows, type Row, screenText, spilled } from "./ttytext";

export const ttyRows = 24;

const hosts = new Map<number, HTMLElement>();
const showTty = StateEffect.define<{ id: number; on: boolean }>();

const liveTtys = StateField.define<Set<number>>({
  create: () => new Set(),
  update(ids, tr) {
    let next = ids;
    for (const effect of tr.effects) {
      if (!effect.is(showTty)) continue;
      next = new Set(next);
      if (effect.value.on) next.add(effect.value.id);
      else next.delete(effect.value.id);
    }
    return next;
  },
});

class TtyWidget extends WidgetType {
  readonly id: number;
  constructor(id: number) {
    super();
    this.id = id;
  }
  eq(other: TtyWidget) {
    return other.id === this.id;
  }
  toDOM() {
    return hosts.get(this.id) ?? document.createElement("div");
  }
  ignoreEvent() {
    return true;
  }
}

const ttyDecorations = EditorView.decorations.compute([liveTtys, blockRuns], (state: EditorState): DecorationSet => {
  const ranges: Range<Decoration>[] = [];
  const runs = state.field(blockRuns);
  for (const id of state.field(liveTtys)) {
    const run = runs.get(id);
    if (run) ranges.push(Decoration.widget({ widget: new TtyWidget(id), block: true, side: 2 }).range(run.to));
  }
  return Decoration.set(ranges, true);
});

export const ttyExtensions = [liveTtys, ttyDecorations];

type Live = {
  term: Terminal;
  fit: FitAddon;
  host: HTMLElement;
  remote: number | null;
  source: EventSource | null;
  queued: string;
  sending: boolean;
  cols: number;
  watcher: ResizeObserver;
};

export type Ttys = {
  toggle(): void;
  stop(id: number): boolean;
  latest(): number | null;
  settle(): Promise<void>;
  size: () => number;
  inside(target: EventTarget | null): boolean;
};

export function interactiveRuns(
  view: () => EditorView,
  allocate: () => number,
  note: (text: string) => void,
  screenLines: () => number,
  changed: () => void,
): Ttys {
  const live = new Map<number, Live>();

  const inside = (target: EventTarget | null) =>
    target instanceof Node && [...live.values()].some((run) => run.host.contains(target));

  function toggle() {
    const v = view();
    if (inside(document.activeElement)) return v.focus();
    const block = shellBlockAt(v.state, v.state.selection.main.head);
    if (!block) return note("no command here — put the cursor in a ```sh block");
    const runs = v.state.field(blockRuns);
    for (const [id, run] of live) {
      if (runs.get(id)?.from === block.from) return run.term.focus();
    }
    void start(block.from, block.to, block.command);
  }

  async function start(from: number, to: number, command: string) {
    const id = allocate();
    const host = document.createElement("div");
    host.className = "cm-relay-tty";
    hosts.set(id, host);
    const term = terminal();
    const fit = new FitAddon();
    term.loadAddon(fit);
    const run: Live = { term, fit, host, remote: null, source: null, queued: "", sending: false, cols: 80, watcher: new ResizeObserver(() => resize(run)) };
    live.set(id, run);
    changed();

    const now = Date.now();
    view().dispatch({
      effects: [
        beginRun.of({ id, from, to, command, phase: "running", queuedAt: now, startedAt: now, finishedAt: null }),
        showTty.of({ id, on: true }),
      ],
    });
    term.open(host);
    run.cols = columns(run);
    term.resize(run.cols, ttyRows);
    term.focus();
    run.watcher.observe(host);
    term.onData((data) => send(run, data));

    let res: Response;
    try {
      res = await fetch(`/tty?cols=${run.cols}`, { method: "POST", body: command });
    } catch (err) {
      return finish(id, { code: null, stopped: true, capped: false }, `relay could not run it: ${err}`);
    }
    if (!res.ok) return finish(id, { code: null, stopped: false, capped: false }, (await res.text()).trim() || `relay could not run it: HTTP ${res.status}`);
    run.remote = ((await res.json()) as { id: number }).id;
    if (!live.has(id)) return void fetch(`/tty/stop?id=${run.remote}`, { method: "POST" }).catch(() => {});
    if (run.queued) void drain(run);

    const source = new EventSource(`/tty/out?id=${run.remote}`);
    run.source = source;
    source.addEventListener("out", (e) => term.write(decode((e as MessageEvent<string>).data)));
    source.addEventListener("exit", (e) => {
      source.close();
      void finish(id, JSON.parse((e as MessageEvent<string>).data) as Ended);
    });
    source.addEventListener("error", () => {
      if (source.readyState === EventSource.CLOSED) return;
      source.close();
      void finish(id, { code: null, stopped: true, capped: false });
    });
  }

  async function finish(id: number, ended: Ended, failure?: string) {
    const run = live.get(id);
    if (!run) return;
    live.delete(id);
    run.source?.close();
    const wasInside = run.host.contains(document.activeElement);
    await new Promise<void>((resolve) => run.term.write("", resolve));

    const text = failure ?? screenText(rows(run.term.buffer.active));
    const screen = screenLines();
    let kept = text;
    if (!failure && run.remote !== null && overflows(text, screen)) {
      try {
        const res = await fetch(`/tty/keep?id=${run.remote}`, { method: "POST", body: text });
        if (res.ok) kept = spilled(text, screen, await res.text());
      } catch {
      }
    }

    const v = view();
    const block = blockFor(v.state, id);
    const effects = [showTty.of({ id, on: false }), updateRun.of({ id, phase: phaseOf(ended, failure !== undefined), at: Date.now() })];
    if (block) {
      const plan = startOutput(v.state, block);
      const open = plan.insert.slice(0, plan.at - plan.from);
      const close = plan.insert.slice(plan.at - plan.from);
      v.dispatch({ changes: { from: plan.from, to: plan.to, insert: open + outputBody(kept, ended) + close }, effects });
    } else v.dispatch({ effects });

    run.watcher.disconnect();
    run.term.dispose();
    hosts.delete(id);
    if (run.remote !== null) void fetch(`/tty/done?id=${run.remote}`, { method: "POST" }).catch(() => {});
    if (wasInside) v.focus();
    changed();
  }

  function stop(id: number): boolean {
    const run = live.get(id);
    if (!run) return false;
    if (run.remote !== null) void fetch(`/tty/stop?id=${run.remote}`, { method: "POST" }).catch(() => {});
    return true;
  }

  function send(run: Live, data: string) {
    run.queued += data;
    if (run.remote !== null && !run.sending) void drain(run);
  }

  async function drain(run: Live) {
    run.sending = true;
    while (run.queued) {
      const body = run.queued;
      run.queued = "";
      try {
        await fetch(`/tty/in?id=${run.remote}`, { method: "POST", body });
      } catch {
      }
    }
    run.sending = false;
  }

  function resize(run: Live) {
    const cols = columns(run);
    if (cols === run.cols) return;
    run.cols = cols;
    run.term.resize(cols, ttyRows);
    if (run.remote !== null) void fetch(`/tty/size?id=${run.remote}&cols=${cols}`, { method: "POST" }).catch(() => {});
  }

  return {
    toggle,
    stop,
    latest: () => [...live.keys()].at(-1) ?? null,
    settle: () => Promise.all([...live.keys()].map((id) => finish(id, "accept"))).then(() => {}),
    size: () => live.size,
    inside,
  };
}

function phaseOf(ended: Ended, failed: boolean): RunPhase {
  if (failed) return "failed";
  if (ended === "accept" || ended.stopped || ended.capped) return "stopped";
  return ended.code === 0 ? "succeeded" : "failed";
}

function blockFor(state: EditorState, id: number) {
  const run = state.field(blockRuns).get(id);
  if (!run) return null;
  const block = shellBlockAt(state, run.from);
  return block && block.from === run.from ? block : null;
}

function columns(run: Live): number {
  return Math.max(20, run.fit.proposeDimensions()?.cols ?? 80);
}

function rows(buffer: IBuffer): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const next = buffer.getLine(i + 1);
    out.push({ text: line.translateToString(!next?.isWrapped), wrapped: line.isWrapped });
  }
  return out;
}

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function terminal(): Terminal {
  return new Terminal({
    rows: ttyRows,
    cursorBlink: true,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.15,
    scrollback: 10000,
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
}

import { MapMode, type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";

import { shellBlockAt } from "./runblock.ts";

export type RunPhase = "queued" | "running" | "succeeded" | "failed" | "stopped" | "skipped";
export type BlockRun = {
  id: number;
  from: number;
  to: number;
  command: string;
  phase: RunPhase;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export const beginRun = StateEffect.define<BlockRun>();
export const updateRun = StateEffect.define<{ id: number; phase: RunPhase; at: number }>();
const tick = StateEffect.define<number>();

export function unfinished(phase: RunPhase): boolean {
  return phase === "queued" || phase === "running";
}

export function elapsed(run: BlockRun, now: number): string {
  const seconds = Math.max(0, Math.floor(((run.finishedAt ?? now) - (run.startedAt ?? run.queuedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export const blockRuns = StateField.define<Map<number, BlockRun>>({
  create: () => new Map(),
  update(runs, tr) {
    const next = new Map<number, BlockRun>();
    for (const [id, run] of runs) {
      const from = tr.changes.mapPos(run.from, 1, MapMode.TrackDel);
      const to = tr.changes.mapPos(run.to, -1, MapMode.TrackDel);
      if (from === null || to === null || from >= to) continue;
      next.set(id, { ...run, from, to });
    }
    for (const effect of tr.effects) {
      if (effect.is(beginRun)) {
        for (const [id, run] of next) {
          if (run.from === effect.value.from && !unfinished(run.phase)) next.delete(id);
        }
        next.set(effect.value.id, effect.value);
      }
      if (effect.is(updateRun)) {
        const run = next.get(effect.value.id);
        if (!run) continue;
        const { phase, at } = effect.value;
        next.set(run.id, {
          ...run,
          phase,
          startedAt: phase === "running" ? at : run.startedAt,
          finishedAt: unfinished(phase) ? null : at,
        });
      }
    }
    return next;
  },
});

const labels: Record<RunPhase, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  stopped: "Stopped",
  skipped: "Skipped",
};

class RunStatus extends WidgetType {
  readonly run: BlockRun;
  readonly time: string;
  readonly edited: boolean;
  readonly stop: (id: number) => void;
  constructor(run: BlockRun, time: string, edited: boolean, stop: (id: number) => void) {
    super();
    this.run = run;
    this.time = time;
    this.edited = edited;
    this.stop = stop;
  }
  eq(other: RunStatus) {
    return this.run.id === other.run.id && this.run.phase === other.run.phase && this.time === other.time && this.edited === other.edited;
  }
  toDOM(view: EditorView) {
    const row = document.createElement("div");
    row.dataset.runId = String(this.run.id);
    const id = document.createElement("span");
    id.className = "cm-run-id";
    id.textContent = `Run ${this.run.id}`;
    const status = document.createElement("span");
    status.className = "cm-run-phase";
    status.setAttribute("role", "status");
    const time = document.createElement("span");
    time.className = "cm-run-time";
    time.setAttribute("aria-live", "off");
    const edited = document.createElement("span");
    edited.className = "cm-run-edited";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = "Stop";
    stop.setAttribute("aria-label", `Stop run ${this.run.id}`);
    stop.addEventListener("mousedown", (event) => event.preventDefault());
    stop.addEventListener("click", () => {
      this.stop(this.run.id);
      view.focus();
    });
    row.append(id, status, time, edited, stop);
    this.updateDOM(row);
    return row;
  }
  updateDOM(row: HTMLElement) {
    if (row.dataset.runId !== String(this.run.id)) return false;
    row.className = `cm-run-status cm-run-${this.run.phase}`;
    row.title = this.run.command;
    const status = row.querySelector<HTMLElement>(".cm-run-phase")!;
    if (status.textContent !== labels[this.run.phase]) status.textContent = labels[this.run.phase];
    row.querySelector(".cm-run-time")!.textContent = `${this.time}${this.run.phase === "queued" ? " waiting" : ""}`;
    row.querySelector(".cm-run-edited")!.textContent = this.edited ? "command edited" : "";
    row.querySelector<HTMLButtonElement>("button")!.hidden = this.run.phase !== "running";
    return true;
  }
  ignoreEvent() {
    return true;
  }
}

export function runStatuses(stop: (id: number) => void) {
  const build = (state: EditorState, now: number): DecorationSet => {
    const ranges: Range<Decoration>[] = [];
    for (const run of state.field(blockRuns).values()) {
      const block = shellBlockAt(state, run.from);
      if (!block || block.from !== run.from || block.to !== run.to) continue;
      ranges.push(Decoration.widget({
        widget: new RunStatus(run, elapsed(run, now), block.command !== run.command, stop),
        block: true,
        side: 1,
      }).range(run.to));
    }
    return Decoration.set(ranges, true);
  };
  const decorations = StateField.define<DecorationSet>({
    create: (state) => build(state, Date.now()),
    update: (_value, tr) => build(tr.state, tr.effects.find((effect) => effect.is(tick))?.value ?? Date.now()),
    provide: (field) => EditorView.decorations.from(field),
  });
  const clock = ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setInterval>;
    constructor(view: EditorView) {
      this.timer = setInterval(() => {
        if ([...view.state.field(blockRuns).values()].some((run) => unfinished(run.phase))) {
          view.dispatch({ effects: tick.of(Date.now()) });
        }
      }, 1000);
    }
    destroy() {
      clearInterval(this.timer);
    }
  });
  return [blockRuns, decorations, clock];
}

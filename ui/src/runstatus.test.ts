import assert from "node:assert/strict";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { shellBlockAt, startOutput } from "./runblock.ts";
import { beginRun, blockRuns, type BlockRun, elapsed, runStatuses, unfinished, updateRun } from "./runstatus.ts";

const doc = "```sh\necho first\n```\n\n```sh\necho second\n```";
const first: BlockRun = { id: 1, from: 0, to: 20, command: "echo first", phase: "queued", queuedAt: 1000, startedAt: null, finishedAt: null };
const second: BlockRun = { ...first, id: 2, from: 22, to: doc.length, command: "echo second" };
let state = EditorState.create({ doc, extensions: [blockRuns] });
const change = (...effects: TransactionSpec[]) => { state = state.update(...effects).state; };
const run = (id = 1) => state.field(blockRuns).get(id)!;

change({ effects: [beginRun.of(first), beginRun.of(second)] });
assert.equal(state.field(blockRuns).size, 2);
assert.equal(elapsed(run(), 4000), "3s");
change({ effects: updateRun.of({ id: 1, phase: "running", at: 5000 }) });
assert.equal(run().startedAt, 5000);
assert.equal(elapsed(run(), 6000), "1s");
assert.equal(run(2).phase, "queued");
change({ effects: updateRun.of({ id: 1, phase: "succeeded", at: 8000 }) });
assert.equal(elapsed(run(), 100000), "3s");
assert.equal(run().finishedAt, 8000);
assert.equal(state.doc.toString(), doc);
change({ changes: { from: 0, insert: "Heading\n\n" } });
assert.equal(run().from, 9);
assert.equal(run().to, 29);
assert.equal(run(2).from, 31);
change({ effects: beginRun.of({ ...run(), id: 3, phase: "running", startedAt: 9000, finishedAt: null }) });
assert.equal(state.field(blockRuns).has(1), false);
assert.equal(state.field(blockRuns).has(2), true);
change({ effects: beginRun.of({ ...run(3), id: 4 }) });
assert.equal(state.field(blockRuns).has(3), true);
change({ effects: updateRun.of({ id: 3, phase: "stopped", at: 11000 }) });
assert.equal(run(3).phase, "stopped");
assert.equal(run(4).phase, "running");
change({ effects: updateRun.of({ id: 2, phase: "skipped", at: 12000 }) });
assert.equal(run(2).phase, "skipped");
assert.equal(run(2).startedAt, null);
change({ changes: { from: 9, to: 30, insert: "" } });
assert.equal(state.field(blockRuns).has(3), false);
assert.equal(state.field(blockRuns).has(4), false);
assert.equal(state.field(blockRuns).has(2), true);
change({ effects: updateRun.of({ id: 4, phase: "failed", at: 13000 }) });
assert.equal(state.field(blockRuns).has(4), false);
assert.equal(elapsed({ ...first, startedAt: 0 }, 65000), "1m 5s");
assert.equal(elapsed({ ...first, startedAt: 0 }, 3660000), "1h 1m");
assert.equal(elapsed(first, 0), "0s");
assert.deepEqual(["queued", "running", "succeeded", "failed", "stopped", "skipped"].map(phase => unfinished(phase as BlockRun["phase"])), [true, true, false, false, false, false]);
console.log("ok   per-command state, frozen durations, reruns, mapping, deletion, and independent stops");

let decorated = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), runStatuses(() => {})] });
const edit = (...specs: TransactionSpec[]) => { decorated = decorated.update(...specs).state; };
const badges = () => decorated.facet(EditorView.decorations).flatMap(set => {
  if (typeof set === "function") return [];
  const found: { run: BlockRun; edited: boolean }[] = [];
  set.between(0, decorated.doc.length, (_from, _to, value) => { found.push(value.spec.widget); });
  return found;
});
const start = (id: number) => {
  const block = shellBlockAt(decorated, decorated.doc.toString().indexOf("```sh"))!;
  const plan = startOutput(decorated, block);
  edit({
    changes: { from: plan.from, to: plan.to, insert: plan.insert },
    effects: beginRun.of({ ...first, id, ...block }),
  });
};
start(1);
assert.equal(badges().length, 1);
edit({ changes: { from: 0, insert: "Heading\n\n" } });
assert.equal(badges()[0]!.run.from, 9);
edit({ changes: { from: decorated.doc.toString().indexOf("first"), insert: "edited " } });
assert.equal(badges()[0]!.edited, true);
assert.equal(badges()[0]!.run.command, "echo first");
start(2);
assert.deepEqual(badges().map(badge => [badge.run.id, badge.edited]), [[1, true], [2, false]]);
edit({ effects: updateRun.of({ id: 1, phase: "succeeded", at: 4000 }) });
start(3);
assert.deepEqual(badges().map(badge => badge.run.id), [2, 3]);
const block = shellBlockAt(decorated, 9)!;
edit({ changes: { from: block.from, to: block.to } });
assert.equal(badges().length, 0);
assert.equal(decorated.field(blockRuns).size, 0);
console.log("ok   badges stay on real fences through output replacement, overlapping runs, command edits, and deletion");

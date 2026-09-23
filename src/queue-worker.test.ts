import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runQueue, type QueueEntry, type QueuePlan } from "./queue-worker.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
}

const dir = mkdtempSync(join(tmpdir(), "relay-handoff-"));
const status = join(dir, "run-1.log.status");
const plan: QueuePlan = {
  cwd: dir,
  dir,
  started: { 1: status },
  finished: {},
  waiting: [
    { id: 2, command: "printf hello", previous: 1 },
    { id: 3, command: "exit 4", previous: 2 },
    { id: 4, command: "touch should-not-exist", previous: 3 },
  ],
};
const running = runQueue(plan);
check("the queue waits for an active predecessor", JSON.parse(readFileSync(join(dir, "queue-report.json"), "utf8"))[0].status, "waiting");
writeFileSync(status, "0");
await running;
const report = JSON.parse(readFileSync(join(dir, "queue-report.json"), "utf8")) as QueueEntry[];
check("success, failure, and skip are reported", report.map((entry) => entry.status), ["succeeded", "failed", "skipped"]);
check("command output stays on disk", readFileSync(report[0]!.output!, "utf8"), "hello");
check("the skipped command has no output", report[2]!.output, null);

const failed = { ...plan, started: {}, finished: { 1: false }, waiting: plan.waiting.slice(0, 2) };
await runQueue(failed);
check("a failed predecessor skips its entire chain", (JSON.parse(readFileSync(join(dir, "queue-report.json"), "utf8")) as QueueEntry[]).map((item) => item.status), ["skipped", "skipped"]);
rmSync(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

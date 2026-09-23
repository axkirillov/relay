import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Waiting = { id: number; command: string; previous: number };
export type QueuePlan = {
  cwd: string;
  dir: string;
  waiting: Waiting[];
  started: Record<number, string>;
  finished: Record<number, boolean>;
};

export type QueueEntry = { id: number; command: string; status: "waiting" | "running" | "succeeded" | "failed" | "skipped"; output: string | null };

export async function runQueue(plan: QueuePlan): Promise<void> {
  const report = join(plan.dir, "queue-report.json");
  const entries: QueueEntry[] = plan.waiting.map(({ id, command }) => ({ id, command, status: "waiting", output: null }));
  const outcomes = new Map<number, boolean>(Object.entries(plan.finished).map(([id, ok]) => [Number(id), ok]));
  const save = () => {
    const temp = `${report}.tmp`;
    writeFileSync(temp, JSON.stringify(entries, null, 2) + "\n");
    renameSync(temp, report);
  };
  save();

  for (const [index, item] of plan.waiting.entries()) {
    const entry = entries[index]!;
    let success = outcomes.get(item.previous);
    if (success === undefined) {
      const file = plan.started[item.previous];
      if (file) {
        while (success === undefined) {
          try {
            success = readFileSync(file, "utf8").trim() === "0";
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      } else success = false;
    }
    if (!success) {
      entry.status = "skipped";
      outcomes.set(item.id, false);
      save();
      continue;
    }
    entry.status = "running";
    entry.output = join(plan.dir, `queue-${item.id}.log`);
    save();
    const code = await new Promise<number | null>((resolve) => {
      const shell = process.env.SHELL || "/bin/sh";
      const output = openSync(entry.output!, "w");
      const child = spawn(shell, ["-c", item.command], { cwd: plan.cwd, stdio: ["ignore", output, output] });
      child.once("error", () => resolve(null));
      child.once("close", (code) => resolve(code));
      closeSync(output);
    });
    success = code === 0;
    entry.status = success ? "succeeded" : "failed";
    outcomes.set(item.id, success);
    save();
  }
}

if (process.argv[1]?.endsWith("queue-worker.js") && process.argv[2]) {
  const plan = JSON.parse(readFileSync(process.argv[2], "utf8")) as QueuePlan;
  void runQueue(plan);
}

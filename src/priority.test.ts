import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "relay-priority-"));
process.env.RELAY_QUEUE_DIR = join(home, "queue");

const { all, mark, marked } = await import("./priority.ts");
const { note, taskDir } = await import("./task.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

const one = join(home, "work", "relay", "priority-sessions");
const two = join(home, "work", "composer", "fleet-rows");

check("nothing is marked to begin with", marked(one), false);
check("and nothing is listed", all(), []);

{
  mark(one, true);
  check("marked", marked(one), true);
  check("listed", all(), [one]);
  check("another session is untouched", marked(two), false);
  check("the task's directory says which path it is", readFileSync(join(taskDir(one), "task"), "utf8"), one + "\n");
}

{
  mark(one, true);
  check("marking again is not a toggle back", marked(one), true);
  check("and not a second entry", all(), [one]);
}

{
  mark(two, true);
  check("two sessions can be marked", all(), [two, one].sort());
  mark(two, false);
  check("and one can be let go without the other", [marked(one), marked(two)], [true, false]);
  check("only the one left is listed", all(), [one]);
}

{
  mark(one, false);
  check("unmarked", marked(one), false);
  check("nothing listed", all(), []);
  mark(one, false);
  check("unmarking again is quiet", marked(one), false);
  check("and the task's own directory stays", existsSync(taskDir(one)), true);
}

{
  const round = "20260821-094401-a-question";
  mkdirSync(join(home, round), { recursive: true });
  note(one, round);
  mark(one, true);
  const { rounds } = await import("./task.ts");
  check("the mark is not counted as a round", rounds(one).length, 1);
  mark(one, false);
  check("and taking it back leaves the round", rounds(one).length, 1);
}

{
  const old = join(home, "queue", "..", "tasks", "ancient-000000");
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, "priority"), "");
  check("a nameless marked directory is left out", all(), []);
  rmSync(old, { recursive: true, force: true });
}

rmSync(home, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

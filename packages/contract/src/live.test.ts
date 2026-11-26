import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { alive, beatMs, fresh, keepingTime, staleMs } from "./live.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

const now = 1_700_000_000_000;
const longAwake = now - 60 * 60_000;
const asleep = 15 * 60_000;

check("a file touched a moment ago is live", fresh(now - 500, now, longAwake), true);
check("a file touched within the window is live", fresh(now - (staleMs - 1), now, longAwake), true);

check("a stale file is dead to a reader that was awake for it", fresh(now - staleMs, now, longAwake), false);
check("fifteen minutes stale is dead too", fresh(now - asleep, now, longAwake), false);

check("nothing is stale to a reader that just woke", fresh(now - asleep, now, now - 300), true);
check("nor to one one beat into being awake", fresh(now - asleep, now, now - beatMs), true);
check("but it is once the reader has been awake longer than the window", fresh(now - asleep, now, now - staleMs), false);

const t = Date.now();

keepingTime(t - 200_000);
keepingTime(t - 60_000);
for (let ms = 58_000; ms >= 0; ms -= beatMs) keepingTime(t - ms);
check("a reader that kept the beat all along still calls a stale file dead", fresh(t - asleep, t), false);

keepingTime(t - asleep);
check("but one whose own last look was before the gap grants the grace itself", fresh(t - asleep, t), true);

const dir = mkdtempSync(join(tmpdir(), "live-"));
const file = join(dir, "ticket.json");
writeFileSync(file, "{}\n");

const child = spawn("sleep", ["30"], { stdio: "ignore" });
const pid = child.pid ?? 0;
check("a live pid with a fresh file is alive", alive(file, pid), true);

const old = new Date(Date.now() - asleep);
utimesSync(file, old, old);
check("a live pid keeps its place while the reader is still waking", alive(file, pid), true);

child.kill("SIGKILL");
await new Promise((r) => setTimeout(r, 200));
check("a dead pid is dead however stale or fresh its file", alive(file, pid), false);

check("a missing file is nobody", alive(join(dir, "gone.json"), process.ppid), false);

rmSync(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

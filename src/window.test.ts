import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "relay-open-"));
process.env.RELAY_QUEUE_DIR = join(dir, "queue");
mkdirSync(process.env.RELAY_QUEUE_DIR, { recursive: true });

const { shouldOpen } = await import("./window.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

check("a rehearsal starts no window of its own", shouldOpen(), false);

delete process.env.RELAY_QUEUE_DIR;
process.env.HOME = dir;
check("their own line, with nothing up, starts one", shouldOpen(), true);

process.exit(fails ? 1 : 0);

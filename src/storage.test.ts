import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "relay-storage-"));
process.env.RELAY_QUEUE_DIR = join(home, "queue");

const { claim, open } = await import("./storage.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

const rounds = () => readdirSync(home).filter((n) => n !== "queue").sort();
const sent = (dir: string) => readFileSync(join(dir, "sent.md"), "utf8");

// --- the name a round gets when another already has it -----------------------
// The stamp only counts seconds, and two relays on one document can start inside
// the same one, so this is asked for directly rather than waited for.
check("the first asker gets the name it asked for", claim("20260813-194031-review").id, "20260813-194031-review");
check("the second gets a -2", claim("20260813-194031-review").id, "20260813-194031-review-2");
check("the third a -3", claim("20260813-194031-review").id, "20260813-194031-review-3");
check("a name nobody holds is untouched", claim("20260813-194032-reply").id, "20260813-194032-reply");
check("each name is a directory of its own", rounds().length, 4);

// --- so two rounds are never each other's ------------------------------------
const first = open("review.md", "one");
const second = open("review.md", "two");
check("two relays, two directories", first.dir === second.dir, false);
check("both are really there", [existsSync(first.dir), existsSync(second.dir)], [true, true]);
check("the first still has what it was sent", sent(first.dir), "one");
check("and the second has its own", sent(second.dir), "two");

process.exit(fails ? 1 : 0);

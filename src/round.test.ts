import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "relay-round-"));
process.env.RELAY_QUEUE_DIR = join(home, "queue");

const { read } = await import("./round.ts");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function refusal(named: string): string {
  try {
    read(named);
    return "it did not refuse";
  } catch (err) {
    return (err as Error).message;
  }
}

function plant(
  id: string,
  what: { sent: string; accepted?: string; source?: string; cwd?: string; meta?: boolean },
): string {
  const dir = join(home, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sent.md"), what.sent);
  if (what.accepted !== undefined) writeFileSync(join(dir, "accepted.md"), what.accepted);
  if (what.meta !== false) {
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({
        id,
        source: what.source ?? "/Users/x/work/relay/scratch/question.md",
        cwd: what.cwd,
        opened: "2026-09-01T09:12:00.000Z",
        accepted: what.accepted === undefined ? undefined : "2026-09-01T09:31:00.000Z",
      }),
    );
  }
  return dir;
}

const tree = join(home, "work", "relay", "read-past-relays");
mkdirSync(tree, { recursive: true });

const answered = plant("20260901-091200-which-cap", {
  sent: "# Which cap\n\nRaise it to 250k?\n",
  accepted: "# Which cap\n\nRaise it to 250k?\nFix the query instead.\n",
  cwd: tree,
});

check("an id is a round", read("20260901-091200-which-cap").id, "20260901-091200-which-cap");
check("so is the path to it", read(answered).id, "20260901-091200-which-cap");
check("and they are the same round", JSON.stringify(read(answered)), JSON.stringify(read("20260901-091200-which-cap")));
check("a trailing slash is the same path", read(answered + "/").id, "20260901-091200-which-cap");

check("what goes on screen is the answer", read(answered).shown.endsWith("Fix the query instead.\n"), true);
check("the baseline is what the agent sent", read(answered).sent, "# Which cap\n\nRaise it to 250k?\n");
check("and it says they answered", read(answered).answered, true);
check("the document is named as it was", read(answered).source, "/Users/x/work/relay/scratch/question.md");

const unanswered = plant("20260901-101500-no-reply", { sent: "# Which index\n\nWhich one is it missing?\n", cwd: tree });
check("with no answer, what is shown is what was sent", read(unanswered).shown, read(unanswered).sent);
check("and it says so", read(unanswered).answered, false);

const lying = plant("20260901-104500-claims-an-answer", { sent: "# Asked\n", cwd: tree });
writeFileSync(join(lying, "meta.json"), JSON.stringify({ id: "x", accepted: "2026-09-01T10:50:00.000Z" }));
check("a meta that says answered with no answer beside it does not", read(lying).answered, false);

check("a round that is not there says so", refusal("20260901-999999-never-happened"), "no such round: 20260901-999999-never-happened");
check("a path that is not there says so too", refusal(join(home, "gone")), `no such round: ${join(home, "gone")}`);
writeFileSync(join(home, "not-a-round"), "a file where a directory should be\n");
check("so does a file standing where a round should be", refusal("not-a-round"), "no such round: not-a-round");

const empty = join(home, "20260901-110000-kept-nothing");
mkdirSync(empty, { recursive: true });
check(
  "a round with no document is the other refusal",
  refusal("20260901-110000-kept-nothing"),
  "20260901-110000-kept-nothing kept no document — nothing to read",
);

check("the tree it ran in, when it is still there", read(answered).cwd, tree);
check("and the record of it either way", read(answered).ran, tree);

const razed = join(home, "work", "relay", "torn-down");
mkdirSync(razed, { recursive: true });
const orphan = plant("20260901-113000-in-a-tree-that-went", { sent: "# Run this\n\n```sh\npnpm test\n```\n", cwd: razed });
check("a tree still standing is a cwd", read(orphan).cwd, razed);
rmSync(razed, { recursive: true });
check("once it is gone there is nowhere to run", read(orphan).cwd, undefined);
check("but the round still says which tree it was", read(orphan).ran, razed);
check("and the document is unaffected", read(orphan).sent.includes("pnpm test"), true);

const bare = plant("20260901-120000-before-the-meta", { sent: "# From before\n", meta: false });
check("with no meta, the document names itself", read(bare).source, join(bare, "sent.md"));
check("and nothing claims a tree", [read(bare).cwd, read(bare).ran], [undefined, undefined]);
check("what it sent is still what it sent", read(bare).shown, "# From before\n");

process.exit(fails ? 1 : 0);

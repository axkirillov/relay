import { spillNotice, spillPath } from "./spill.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/** The notice as the run writes it: a line of its own, output around it. */
const written = (path: string) => `out\nmore out\n\n${spillNotice(path)}\n\n… 4,880 more lines there:\n`;

// --- what the fold reads back ------------------------------------------------
check(
  "the path the run wrote is the path the fold finds",
  spillPath(written("~/.relay/20260812-1433-doc/run-1.log")),
  "~/.relay/20260812-1433-doc/run-1.log",
);
check("an absolute path too", spillPath(written("/tmp/relay-logs/run-2.log")), "/tmp/relay-logs/run-2.log");
check("output that never spilled names nothing", spillPath("ordinary\noutput\n[exit 1]\n"), null);
check("nor does an empty document", spillPath(""), null);

// --- output that talks about spilling ----------------------------------------
check(
  "a command that printed the sentence itself does not win",
  spillPath(`echo "… long output — all of it is in /dev/null"\n${written("~/.relay/r/run-1.log")}`),
  "~/.relay/r/run-1.log",
);
check("a sentence with no path after it names nothing", spillPath(spillNotice("")), null);

process.exit(fails ? 1 : 0);

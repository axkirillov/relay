import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { held, holdBuild, pruneBuilds } from "./builds.ts";

const home = realpathSync(mkdtempSync(join(tmpdir(), "relay-builds-")));
const builds = join(home, "dist", "builds");

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function build(id: string, holders: number[] = []): string {
  const dir = join(builds, id);
  mkdirSync(join(dir, "holders"), { recursive: true });
  writeFileSync(join(dir, "relay.js"), "");
  for (const pid of holders) writeFileSync(join(dir, "holders", String(pid)), "");
  return dir;
}

const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" });
const gone = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
await new Promise((r) => gone.once("exit", r));

check("a build with a running holder is held", held(build("a", [sleeper.pid!])), true);
check("a build whose holders have all exited is not held", held(build("b", [gone.pid!])), false);
check("a build nobody ever held is not held", held(build("c")), false);
build("d");
build("e");

check("pruning removes only unheld builds that are not kept", pruneBuilds(builds, ["d", "e"]).sort(), ["b", "c"]);
check("what is left", readdirSync(builds).sort(), ["a", "d", "e"]);

const link = join(home, "dist", "relay.js");
symlinkSync("builds/d/relay.js", link);
holdBuild(link);
check("holding through a link marks the build the link resolves to", existsSync(join(builds, "d", "holders", String(process.pid))), true);
check("and the build is then held", held(join(builds, "d")), true);

const outside = join(home, "src");
mkdirSync(outside);
writeFileSync(join(outside, "cli.ts"), "");
holdBuild(join(outside, "cli.ts"));
check("running from outside a build marks nothing", existsSync(join(outside, "holders")), false);

sleeper.kill();
rmSync(home, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

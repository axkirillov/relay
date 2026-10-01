import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { which } from "./edit.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

const cwd = mkdtempSync(join(tmpdir(), "relay-edit-"));

const bin = join(cwd, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "nvim"), "#!/bin/sh\n", { mode: 0o755 });
writeFileSync(join(bin, "notexec"), "#!/bin/sh\n", { mode: 0o644 });
check("it finds a program on the path", which("nvim", `/nowhere:${bin}`), join(bin, "nvim"));
check("a file nobody can run is not a program", which("notexec", bin), null);
check("a directory is not a program", which("bin", cwd), null);
check("nothing on an empty path", which("nvim", ""), null);

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);

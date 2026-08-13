import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { argv, locate, which } from "./edit.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

const cwd = mkdtempSync(join(tmpdir(), "relay-edit-"));
mkdirSync(join(cwd, "src"));
writeFileSync(join(cwd, "src", "cli.ts"), "hello\n");

// --- locate ------------------------------------------------------------------
check("a path is read from the directory relay was run in", locate("src/cli.ts", cwd), join(cwd, "src", "cli.ts"));
check("an absolute path is itself", locate(join(cwd, "src/cli.ts"), cwd), join(cwd, "src", "cli.ts"));
// nvim opens a directory as a listing, which is what vim's own gf does with one.
check("a directory counts", locate("src", cwd), join(cwd, "src"));
check("nothing there is nothing", locate("src/nope.ts", cwd), null);
check("a path out of the tree still has to exist", locate("../../nope", cwd), null);
check("~ is the human's home", locate("~", cwd), homedir());
check("~/ leads there too", locate("~/", cwd), homedir());
// A file whose name begins with a tilde is not a home directory.
check("a tilde in the middle is a name", locate("a~b", cwd), null);

// --- argv --------------------------------------------------------------------
check("no line, no jump", argv("/x/cli.ts"), ["--", "/x/cli.ts"]);
check("a line", argv("/x/cli.ts", 42), ["+42", "--", "/x/cli.ts"]);
check("a line and a column", argv("/x/cli.ts", 42, 7), ["+call cursor(42,7)", "--", "/x/cli.ts"]);
// `--` so that a file whose name begins with a dash is a file, not a switch.
check("a file that looks like a switch", argv("-r", 3), ["+3", "--", "-r"]);

// --- which -------------------------------------------------------------------
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

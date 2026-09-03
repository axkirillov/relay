import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launch, openable, opener } from "./open.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

check("https", openable("https://example.com/x"), "https://example.com/x");
check("http", openable("http://example.com/x"), "http://example.com/x");
check("a file url", openable("file:///etc/hosts"), "file:///etc/hosts");
check("mailto", openable("mailto:someone@example.com"), "mailto:someone@example.com");
check("javascript", openable("javascript:alert(1)"), null);
check("data", openable("data:text/html,<script>boom()</script>"), null);
check("ssh", openable("ssh://box/x"), null);
check("a shell command with a scheme's shape", openable("sh:rm -rf /"), null);
check("a path is not a link", openable("src/cli.ts"), null);
check("a word is not a link", openable("example"), null);
check("nothing", openable(""), null);
check("padded", openable("  https://example.com/x\n"), "https://example.com/x");
check("a newline in the middle", openable("https://example.com/\nx"), "https://example.com/x");
check("shell characters", openable("https://example.com/?a=$(whoami);b=`id`"),
      "https://example.com/?a=$(whoami);b=`id`");

const cwd = mkdtempSync(join(tmpdir(), "relay-open-"));
const bin = join(cwd, "bin");
mkdirSync(bin);
for (const name of ["open", "xdg-open"]) {
  writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}
const wanted = process.platform === "darwin" ? "open" : "xdg-open";
check("the machine's opener", opener(`/nowhere:${bin}`), join(bin, wanted));
check("a machine with none", opener("/nowhere"), null);

const log = join(cwd, "argv");
writeFileSync(join(bin, "record"), `#!/bin/sh\nprintf '%s\\n' "$#" "$@" >'${log}'\n`, { mode: 0o755 });
writeFileSync(join(bin, "refuse"), "#!/bin/sh\nexit 3\n", { mode: 0o755 });

const tricky = openable("https://example.com/?a=$(whoami);b=x&c=y")!;
check("it went whole and alone", await taken(join(bin, "record"), tricky), `1\n${tricky}\n`);
check("an opener that refused", await failed(join(bin, "refuse"), "https://example.com/"), "exit 3");
check("no such opener", (await failed(join(bin, "nope"), "https://example.com/"))?.includes("ENOENT"), true);

async function taken(program: string, url: string): Promise<string> {
  await launch(program, url);
  return readFileSync(log, "utf8");
}

async function failed(program: string, url: string): Promise<string | null> {
  try {
    await launch(program, url);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);

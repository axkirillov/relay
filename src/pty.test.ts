import { tmpdir } from "node:os";

import { open } from "./pty.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

const session = open(tmpdir(), 80, 24);
let said = "";
let code: number | null = null;
const off = session.attach((chunk) => (said += chunk), () => {});
session.attach(() => {}, (c) => (code = c));

check("it starts in the directory it was given", session.cwd, tmpdir());
check("it is alive", session.alive, true);

session.write("printf 'the-answer-%s\\n' 42\r");
await until(() => said.includes("the-answer-42"));
check("the shell answers", said.includes("the-answer-42"), true);

session.write("printf '\\033[32mgreen\\033[0m\\n'\r");
await until(() => said.includes("[32mgreen"));
check("escapes come through untouched", said.includes("[32mgreen"), true);

check("what it said is kept for a page that reloads", session.replay().includes("the-answer-42"), true);

off();
const quiet = said.length;
session.write("printf 'nobody-listening\\n'\r");
await until(() => session.replay().includes("nobody-listening"));
check("a page that let go hears no more", said.length, quiet);

session.write("exit\r");
await until(() => code !== null);
check("it reports the shell exiting", { code, alive: session.alive }, { code: 0, alive: false });

session.kill();
check("killing a dead shell is quiet", session.alive, false);

const short = open(tmpdir(), 80, 24);
short.kill();
check("a shell can be killed before it says anything", short.alive, false);

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);

async function until(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((r) => setTimeout(r, 10));
}

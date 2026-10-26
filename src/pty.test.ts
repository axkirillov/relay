import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SHELL = "/bin/sh";

const { interactive, rows } = await import("./pty.ts");
type Ended = import("./pty.ts").Ended;

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function session(command: string, cwd = process.cwd(), cols = 80) {
  const tty = interactive(command, cwd, cols);
  let out = "";
  const ended = new Promise<Ended>((resolve) => tty.attach((chunk) => (out += chunk), resolve));
  const seen = (needle: string) =>
    new Promise<void>((resolve) => {
      const look = setInterval(() => {
        if (!out.includes(needle)) return;
        clearInterval(look);
        resolve();
      }, 10);
    });
  return { tty, ended, seen, out: () => out };
}

{
  const run = session('printf "name? "; read name; echo "hello $name"');
  await run.seen("name? ");
  run.tty.write("relay\r");
  const ended = await run.ended;
  check("a prompt is answered through the terminal", run.out().includes("hello relay"), true);
  check("a clean exit reports its code", ended, { code: 0, stopped: false, capped: false });
}

{
  const run = session("exit 3");
  check("a failing command reports its code", await run.ended, { code: 3, stopped: false, capped: false });
}

{
  const run = session("[ -t 0 ] && [ -t 1 ] && echo tty || echo pipe");
  await run.ended;
  check("stdin and stdout are a terminal", run.out().trim(), "tty");
}

{
  const run = session("stty size", process.cwd(), 57);
  await run.ended;
  check("the terminal is the agreed size", run.out().trim(), `${rows} 57`);
}

{
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "relay-pty-")));
  const run = session("pwd", dir);
  await run.ended;
  check("it runs in the given directory", run.out().trim(), dir);
  rmSync(dir, { recursive: true, force: true });
}

{
  const run = session('echo ready; trap "" INT; sleep 30');
  await run.seen("ready");
  run.tty.stop();
  const ended = await run.ended;
  check("stop ends it and says so", ended, { code: null, stopped: true, capped: false });
}

{
  const run = session("echo early");
  await run.ended;
  check("what was said before anyone listened is replayed", run.tty.replay().includes("early"), true);
}

{
  const run = session("echo $TERM");
  await run.ended;
  check("it says it is a colour terminal", run.out().trim(), "xterm-256color");
}

if (fails) {
  console.log(`\n${fails} failed`);
  process.exit(1);
}

import { page } from "./page.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

const source = "/Users/x/work/relay/scratch/which-cap.md";
const waiting = page(source);
const framed = page(source, true);
const reading = page(source, true, true);

// --- the document being answered -----------------------------------------------
check("the file is the title", waiting.includes("<title>which-cap.md — relay</title>"), true);
check("on its own it keeps the strip that holds the lights off the first line", waiting.includes("<header>"), true);
check("inside composer's frame that strip is composer's", framed.includes("<header>"), false);
check("and either way there is something to accept", [waiting, framed].map((p) => p.includes(`<button id="accept">`)), [true, true]);
check("said in the keys as well", waiting.includes("<kbd>⌃X</kbd> or <kbd>ZZ</kbd> accept"), true);
check("with the way out of not replying beside it", waiting.includes("<kbd>:q</kbd> close without replying"), true);
check("nothing marks it as a read", waiting.includes("<body>"), true);

// --- the round being read -------------------------------------------------------
// The marker is on the body because the CSP allows one script — the bundle — so there
// is no inline script to carry a flag, and the editor reads it off the DOM instead.
check("a read says so on the body", reading.includes("<body data-read>"), true);
check("there is nothing to accept", reading.includes(`id="accept"`), false);
check("nor a key that accepts", reading.includes("accept</span>"), false);
check("nor a way to close without replying, which is not what closing this is", reading.includes("close without replying"), false);
check("closing it is the gesture it is everywhere else", reading.includes("<kbd>esc</kbd> or <kbd>:q</kbd> close</span>"), true);

// What stays. Everything in the footer that only reads a round is still true of one:
// how much they changed that day, and every gesture that leaves the document alone.
check("how much they changed that day still stands there", reading.includes(`<span id="stats">unchanged</span>`), true);
for (const [what, hint] of [
  ["the terminal", "terminal</span>"],
  ["a command it can still run", "run a command</span>"],
  ["the file under the cursor", "open the file</span>"],
  ["the link under the cursor", "open the link</span>"],
  ["putting a line back", "put a line back</span>"],
  ["the rendering", "render on/off</span>"],
] as const) {
  check(`a read keeps ${what}`, reading.includes(hint), true);
}

// The panes are the page's own furniture and a read has both: a shell in the round's
// own tree, and the nvim a `gf` opens.
check("both panes are there to be opened", [reading.includes(`id="term"`), reading.includes(`id="edit"`)], [true, true]);
check("and the editor bundle is the same one", reading.includes(`<script src="/assets/relay.js"></script>`), true);

process.exit(fails ? 1 : 0);

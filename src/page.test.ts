import assert from "node:assert/strict";
import { page } from "./page.ts";

const source = "/Users/x/work/relay/scratch/which-cap.md";
const waiting = page(source);
const framed = page(source, true);
const reading = page(source, true, true);

assert.ok(waiting.includes("<title>which-cap.md — relay</title>"));
assert.ok(waiting.includes("<header>"));
assert.ok(!framed.includes("<header>"));
assert.ok(waiting.includes("<body>"));
assert.ok(reading.includes("<body data-read>"));
assert.ok(!reading.includes('id="accept"'));
assert.ok(reading.includes('<button id="close" class="button primary" type="button">close <kbd>:q</kbd></button>'));
assert.ok(!reading.includes("Accept and send"));
assert.ok(!reading.includes("Tick or untick"));
assert.ok(!reading.includes("Close without replying"));
assert.ok(reading.includes("Close this read-only round"));
assert.ok(reading.includes("body[data-read] #stats { display: none; }"));

for (const document of [waiting, framed, reading]) {
  assert.ok(document.includes('<span id="stats">unchanged</span>'));
  assert.ok(document.includes('<dialog id="help-dialog" class="card" aria-labelledby="help-title">'));
  assert.ok(document.includes('aria-haspopup="dialog" aria-controls="help-dialog"'));
  assert.ok(document.includes("Open the web link in normal or visual mode"));
  assert.ok(document.includes("Edit the linked file in Neovim"));
  assert.ok(document.includes("Run the shell block under the cursor"));
  assert.ok(document.includes("Toggle rendered blocks and source"));
  assert.ok(!document.includes('id="term"'));
  assert.ok(!document.includes('id="edit"'));
  assert.ok(!document.includes("open the file"));
  const footer = document.match(/<footer>([\s\S]*?)<\/footer>/)![1]!;
  assert.ok(footer.includes('id="context-action"'));
  assert.ok(footer.includes('id="help"'));
  assert.ok(footer.includes('</kbd> <span id="context-label">'));
  assert.ok(footer.includes('<button id="help" class="button soft"'));
  assert.ok(document.includes("<style>:root { --crust: #181926;"));
  assert.ok(document.includes('<div class="keys"><span><kbd>↑↓</kbd> move</span>'));
  assert.equal(footer.match(/class="footer-/g)!.length, 2);
  assert.ok(!footer.includes("run a command"));
  assert.ok(!footer.includes(":raw"));
  assert.ok(!footer.includes(":res"));
  assert.ok(document.includes('<script src="/assets/relay.js"></script>'));
}
for (const document of [waiting, framed]) {
  assert.ok(document.includes('<button id="accept" class="button primary"'));
  assert.ok(document.includes("accept <kbd>⌃X</kbd>"));
  assert.ok(document.includes("<kbd>⌃X</kbd> · <kbd>ZZ</kbd>"));
  assert.ok(document.includes("Close without replying"));
  assert.ok(document.includes("Restore this line or the selected lines"));
}
console.log("ok   key-line footer, help and run-choice cards, and read-only controls");

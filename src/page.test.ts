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
assert.ok(reading.includes('id="close"'));
assert.ok(!reading.includes("Accept and send"));
assert.ok(!reading.includes("Tick or untick"));
assert.ok(!reading.includes("Close without replying"));
assert.ok(reading.includes("Close this read-only round"));

for (const document of [waiting, framed, reading]) {
  assert.ok(document.includes('<span id="stats">unchanged</span>'));
  assert.ok(document.includes('id="help-dialog" aria-labelledby="help-title"'));
  assert.ok(document.includes('aria-haspopup="dialog" aria-controls="help-dialog"'));
  assert.ok(document.includes("Open the link in normal or visual mode"));
  assert.ok(document.includes("Run the shell block under the cursor"));
  assert.ok(document.includes("Toggle rendered blocks and source"));
  assert.ok(!document.includes('id="term"'));
  assert.ok(!document.includes('id="edit"'));
  assert.ok(!document.includes("open the file"));
  const footer = document.match(/<footer>([\s\S]*?)<\/footer>/)![1]!;
  assert.ok(footer.includes('id="context-action"'));
  assert.ok(footer.includes('id="help"'));
  assert.ok(!footer.includes("run a command"));
  assert.ok(!footer.includes(":raw"));
  assert.ok(!footer.includes(":res"));
  assert.ok(document.includes('<script src="/assets/relay.js"></script>'));
}
for (const document of [waiting, framed]) {
  assert.ok(document.includes('<button id="accept" type="button"'));
  assert.ok(document.includes("Accept <kbd>⌃X</kbd>"));
  assert.ok(document.includes("<kbd>⌃X</kbd> · <kbd>ZZ</kbd>"));
  assert.ok(document.includes("Close without replying"));
  assert.ok(document.includes("Restore this line or the selected lines"));
}
console.log("ok   compact footer, labelled shortcut dialog, and read-only controls");

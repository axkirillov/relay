import assert from "node:assert/strict";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import { contextAction } from "./footer.ts";

function action(marked: string, mode = "normal", reading = false) {
  const head = marked.indexOf("|");
  const state = EditorState.create({
    doc: marked.replace("|", ""),
    selection: { anchor: head },
    extensions: [markdown({ base: markdownLanguage })],
  });
  return contextAction(state, mode, reading);
}

assert.deepEqual(action("|Some prose"), { kind: "edit", key: "i", label: "Edit" });
assert.deepEqual(action("|Some prose", "insert"), { kind: "normal", key: "Esc", label: "Normal mode" });
assert.equal(action("|Some prose", "visual").kind, "normal");
assert.deepEqual(action("- [ ] |Answer"), { kind: "tick", key: "⌃J", label: "Tick" });
assert.equal(action("- [x] |Answer", "insert").label, "Untick");
assert.equal(action("- [ ] |Answer", "normal", true).kind, "close");
assert.deepEqual(action("```sh\n|echo ok\n```"), { kind: "run", key: "⌃J", label: "Run" });
assert.equal(action("```sh\n|echo ok\n```", "insert").kind, "run");
assert.equal(action("```sh\n|echo ok\n```", "normal", true).kind, "run");
assert.equal(action("```sh\n|\n```").kind, "edit");
assert.equal(action("```js\n|const a = 1;\n```").kind, "edit");
assert.equal(action("```sh\n|# - [ ] not a checkbox\n```").kind, "run");
assert.deepEqual(action("|https://example.com"), { kind: "link", key: "gx", label: "Open link" });
assert.equal(action("|https://example.com", "insert").kind, "normal");
assert.equal(action("- [ ] |https://example.com").kind, "tick");
assert.equal(action("```sh\n|curl https://example.com\n```").kind, "run");
assert.deepEqual(action("|Some prose", "normal", true), { kind: "close", key: ":q", label: "Close" });
console.log("ok   contextual hints match the available keys and read-only state");

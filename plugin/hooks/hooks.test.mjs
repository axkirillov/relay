import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isRelayCall, plainRelayDecision } from "./plain-relay.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("a plain relay call is allowed, a compound or look-alike one is not", () => {
  for (const command of ["relay /tmp/a.md", "  ~/.local/bin/relay notes.md"]) {
    assert.equal(plainRelayDecision({ tool_name: "Bash", tool_input: { command } }).hookSpecificOutput.permissionDecision, "allow", command);
  }
  for (const command of ["relay a.md; rm -rf x", "rm;~/relay a.md", "relay a.md > ~/.zshrc", "relay a.md && ls", "relay $(cat x)", "echo relay a.md", "relay"]) {
    assert.equal(isRelayCall({ tool_name: "Bash", tool_input: { command } }), false, command);
  }
});

test("the hook answers a plain relay call and stays silent on anything else", () => {
  const run = (command) => execFileSync("node", [join(here, "plain-relay.mjs")], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), encoding: "utf8" });
  assert.equal(JSON.parse(run("relay /tmp/a.md")).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(run("relay a.md && ls"), "");
});

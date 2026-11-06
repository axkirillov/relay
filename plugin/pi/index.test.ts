import assert from "node:assert/strict";
import { test } from "node:test";
import relay, { isRelayCall, opensRelayWindow, relayDocumentPath } from "./index.ts";

test("a relay call is one uncompounded document", () => {
	for (const [command, path] of [
		["relay /tmp/question.md", "/tmp/question.md"],
		["  relay question.md  ", "question.md"],
		["~/.local/bin/relay '/tmp/question with spaces.md'", "/tmp/question with spaces.md"],
		['relay "/tmp/question with spaces.md"', "/tmp/question with spaces.md"],
	]) {
		assert.equal(isRelayCall("bash", { command }), true, command);
		assert.equal(relayDocumentPath(command), path);
	}
	for (const command of [
		"relay",
		"relay /tmp/one.md /tmp/two.md",
		"relay /tmp/question.md && npm test",
		"relay $(find /tmp -name '*.md')",
		"relay /tmp/question.md | tee /tmp/result",
		"echo relay /tmp/question.md",
	]) {
		assert.equal(isRelayCall("bash", { command }), false, command);
	}
	assert.equal(isRelayCall("write", { command: "relay /tmp/question.md" }), false);
});

test("a relay flag opens no window", () => {
	assert.equal(opensRelayWindow("relay /tmp/q.md"), true);
	assert.equal(opensRelayWindow("relay --plugin-dir"), false);
});

test("at session start relay tells auto-mode, the secret scanner and background bash about itself", () => {
	const handlers = new Map<string, (event: unknown) => unknown>();
	const emitted = new Map<string, any>();
	relay({
		on: (name: string, handler: (event: unknown) => unknown) => handlers.set(name, handler),
		events: { emit: (channel: string, data: unknown) => emitted.set(channel, data), on: () => () => {} },
	} as any);
	handlers.get("session_start")?.({});
	const trust = emitted.get("auto-mode:trust");
	assert.equal(trust.name, "relay");
	assert.equal(trust.alone, true);
	assert.equal(trust.allows("bash", { command: "relay /tmp/q.md" }), true);
	assert.match(trust.guidance, /relay <file\.md>/);
	assert.deepEqual(emitted.get("secret-scanner:paths").paths("relay /tmp/q.md"), ["/tmp/q.md"]);
	assert.deepEqual(emitted.get("secret-scanner:paths").paths("ls"), []);
	const hold = emitted.get("background-bash:hold");
	assert.equal(hold.matches("relay /tmp/q.md"), true);
	assert.match(hold.foreground, /run_in_background: true/);
	assert.match(hold.open, /window is open/);
});

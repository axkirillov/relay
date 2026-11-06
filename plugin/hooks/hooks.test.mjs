import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { answersFrom, conversationContext, questionDocument } from "./question.mjs";
import { decide as decidePermission, isRelayCall, permissionDocument, verdictFrom } from "./permission.mjs";
import { applyDiff } from "./window.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "relay-hook-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const questions = [
  {
    question: "Which framework?",
    header: "Framework",
    multiSelect: false,
    options: [{ label: "React", description: "the usual" }, { label: "Vue", description: "smaller" }],
  },
  { question: "Which checks?", header: "Checks", multiSelect: true, options: [{ label: "lint" }, { label: "test" }] },
];

function unifiedDiff(before, after) {
  const dir = mkdtempSync(join(scratch, "diff-"));
  writeFileSync(join(dir, "a"), before);
  writeFileSync(join(dir, "b"), after);
  const run = spawnSync("diff", ["-u", join(dir, "a"), join(dir, "b")], { encoding: "utf8" });
  return run.stdout;
}

test("a diff applied to the sent document gives back what the user saw", () => {
  const sent = questionDocument(questions);
  const edited = sent.replace("- [ ] Vue", "- [x] Vue").replace("Other:\n\n\n## 2", "Other:\n\nmaybe Svelte\n\n## 2");
  assert.equal(applyDiff(sent, unifiedDiff(sent, edited)), edited);
});

test("no changes leaves the document as it was", () => {
  const sent = questionDocument(questions);
  assert.equal(applyDiff(sent, "no changes — the human accepted it as sent\n"), sent);
});

test("ticked options and other text become the answers, keyed by question", () => {
  const edited = questionDocument(questions)
    .replace("- [ ] Vue", "- [x] Vue")
    .replace("- [ ] lint", "- [x] lint")
    .replace("- [ ] test", "- [X] test")
    .replace("Other:\n\n\n## 2", "Other:\n\nmaybe Svelte\n\n## 2");
  assert.deepEqual(answersFrom(edited, questions), { "Which framework?": "Vue, maybe Svelte", "Which checks?": "lint, test" });
});

test("an unanswered question is left out", () => {
  assert.deepEqual(answersFrom(questionDocument(questions), questions), {});
});

test("allow needs Allow ticked and Deny not", () => {
  const sent = permissionDocument({ tool_name: "Bash", cwd: "/w", tool_input: { command: "ls" } });
  assert.deepEqual(verdictFrom(sent), { allow: false, note: "" });
  assert.equal(verdictFrom(sent.replace("- [ ] Allow", "- [x] Allow")).allow, true);
  assert.equal(verdictFrom(sent.replace("- [ ] Allow", "- [x] Allow").replace("- [ ] Deny", "- [x] Deny")).allow, false);
  assert.deepEqual(verdictFrom(sent.replace("Note to Claude:\n", "Note to Claude:\nuse rg\n")), { allow: false, note: "use rg" });
});

test("a call holding backticks gets a longer fence", () => {
  const sent = permissionDocument({ tool_name: "Bash", cwd: "/w", tool_input: { command: "echo ```" } });
  assert.match(sent, /^````json$/m);
});

function stubRelay(edit) {
  const bin = mkdtempSync(join(scratch, "bin-"));
  const script = join(bin, "relay");
  writeFileSync(script, `#!/bin/sh\nsed '${edit}' "$1" > "$1.edited"\ndiff -u "$1" "$1.edited"\nexit 0\n`);
  chmodSync(script, 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}

function runHook(name, input, env) {
  return JSON.parse(execFileSync("node", [join(here, name)], { input: JSON.stringify(input), env, encoding: "utf8" }));
}

test("the question hook answers AskUserQuestion with the user's ticks", () => {
  const input = { cwd: tmpdir(), tool_name: "AskUserQuestion", tool_input: { questions } };
  const out = runHook("question.mjs", input, stubRelay("s/- \\[ \\] React/- [x] React/"));
  assert.deepEqual(out.hookSpecificOutput, {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    updatedInput: { questions, answers: { "Which framework?": "React" } },
  });
});

test("the permission hook allows only when Allow is ticked", () => {
  const input = { cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "ls" } };
  assert.deepEqual(runHook("permission.mjs", input, stubRelay("s/- \\[ \\] Allow/- [x] Allow/")).hookSpecificOutput.decision, { behavior: "allow" });
  assert.equal(runHook("permission.mjs", input, stubRelay("s/x/x/")).hookSpecificOutput.decision.behavior, "deny");
});

test("the question window quotes the last prompt and what Claude said since", () => {
  const transcript = join(scratch, "transcript.jsonl");
  const entry = (type, content) => JSON.stringify({ type, message: { content } });
  writeFileSync(transcript, [
    entry("user", "an older prompt"),
    entry("assistant", [{ type: "text", text: "old reply" }]),
    entry("user", "Pick a colour for the logo"),
    entry("assistant", [{ type: "thinking", thinking: "hm" }]),
    entry("assistant", [{ type: "text", text: "Two shades fit the brand." }]),
    entry("user", [{ type: "tool_result", content: "ok" }]),
  ].join("\n") + "\n");
  const context = conversationContext(transcript);
  assert.deepEqual(context, { prompt: "Pick a colour for the logo", said: "Two shades fit the brand." });
  const sent = questionDocument(questions, { cwd: "/w", ...context });
  assert.match(sent, /^> Pick a colour for the logo$/m);
  assert.match(sent, /^> Two shades fit the brand\.$/m);
  assert.doesNotMatch(sent, /older prompt/);
  assert.deepEqual(answersFrom(sent.replace("- [ ] Vue", "- [x] Vue"), questions), { "Which framework?": "Vue" });
});

test("a missing transcript leaves only the questions", () => {
  assert.deepEqual(conversationContext(join(scratch, "none.jsonl")), {});
});

test("a plain relay call is allowed without opening a window", async () => {
  const never = () => assert.fail("opened a window");
  for (const command of ["relay /tmp/a.md", "  ~/.local/bin/relay notes.md"]) {
    const out = await decidePermission({ tool_name: "Bash", tool_input: { command } }, never);
    assert.equal(out.hookSpecificOutput.decision.behavior, "allow");
  }
  for (const command of ["relay a.md; rm -rf x", "rm;~/relay a.md", "relay a.md > ~/.zshrc", "relay a.md && ls", "relay $(cat x)", "echo relay a.md", "relay"]) {
    assert.equal(isRelayCall({ tool_name: "Bash", tool_input: { command } }), false, command);
  }
});

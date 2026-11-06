import { fileURLToPath } from "node:url";
import { answer, askInRelay, readHookInput } from "./window.mjs";

const noteLabel = "Note to Claude:";

export function permissionDocument(input) {
  const call = JSON.stringify(input.tool_input ?? {}, null, 2);
  const fence = "`".repeat(Math.max(3, ...[...call.matchAll(/`+/g)].map((run) => run[0].length + 1)));
  return [
    `# Claude asks to use ${input.tool_name}`,
    "",
    `In \`${input.cwd}\`:`,
    "",
    `${fence}json`,
    call,
    fence,
    "",
    "- [ ] Allow",
    "- [ ] Deny",
    "",
    noteLabel,
    "",
    "",
  ].join("\n");
}

export function verdictFrom(text) {
  const [body, ...rest] = text.split(noteLabel);
  const ticked = (word) => new RegExp(`^\\s*[-*] \\[[xX]\\] ${word}\\s*$`, "m").test(body);
  return { allow: ticked("Allow") && !ticked("Deny"), note: rest.join(noteLabel).trim() };
}

export function isRelayCall(input) {
  const command = input.tool_input?.command;
  return input.tool_name === "Bash" && typeof command === "string" && /^\s*([^\s;&|$`]*\/)?relay\s+[^;&|$`<>()\n]+$/.test(command);
}

export async function decide(input, ask = askInRelay) {
  if (isRelayCall(input)) return allow();
  const reply = await ask(permissionDocument(input), input.cwd);
  if (!reply.accepted) return deny("The user closed the relay window without answering. Do not retry.");
  const { allow: allowedByUser, note } = verdictFrom(reply.text);
  if (allowedByUser) return allow();
  return deny(note ? `The user denied this in relay: ${note}` : "The user denied this in relay. Do not retry.");
}

function allow() {
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
}

function deny(message) {
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message } } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) answer(await decide(await readHookInput()));

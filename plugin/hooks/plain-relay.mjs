import { fileURLToPath } from "node:url";

export function isRelayCall(input) {
  const command = input.tool_input?.command;
  return input.tool_name === "Bash" && typeof command === "string" && /^\s*([^\s;&|$`]*\/)?relay\s+[^;&|$`<>()\n]+$/.test(command);
}

export function plainRelayDecision(input) {
  if (!isRelayCall(input)) return undefined;
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
}

async function readHookInput(stream = process.stdin) {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return JSON.parse(text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const decision = plainRelayDecision(await readHookInput());
  if (decision) process.stdout.write(JSON.stringify(decision) + "\n");
}

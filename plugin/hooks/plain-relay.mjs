import { fileURLToPath } from "node:url";
import { isRelayCall } from "./permission.mjs";
import { answer, readHookInput } from "./window.mjs";

export function plainRelayDecision(input) {
  if (!isRelayCall(input)) return undefined;
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const decision = plainRelayDecision(await readHookInput());
  if (decision) answer(decision);
}

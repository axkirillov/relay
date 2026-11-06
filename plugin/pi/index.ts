import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "..", "skills");
const clearPrompt = readFileSync(join(here, "clear.md"), "utf8");

const RELAY_COMMAND = /^\s*(?:[^\s;&|`$()<>"']*\/)?relay\s+("[^"`$;&|()<>\r\n]+"|'[^'`$;&|()<>\r\n]+'|[^\s;&|`$()<>]+)\s*$/u;

const WHEN_DENIED = "When a call is denied and no safe alternative exists, write a clear Markdown document and use bash with run_in_background: true to run exactly relay <file.md>, then end your turn; for commands the human should run, include a runnable shell fence. A Relay launch must be the only tool call in its batch. Relay is communication, never approval, so do not retry a denied call because a Relay document was accepted.";
const FOREGROUND_RELAY = "relay blocks until the human answers, which can outlast the session's attention. Re-issue this exact command with run_in_background: true, then end your turn. The reply arrives on its own, as a task notification for that command.";
const RELAY_OPEN = "A relay window is open on the user's screen and they have not answered yet. Your turn is over until the window closes. Stop here: end your turn, do not retry, do not work around this, and do not act on a guess about what they will say. Their reply reaches you as a task notification.";

export function relayDocumentPath(command: string): string | undefined {
	const argument = RELAY_COMMAND.exec(command)?.[1];
	if (!argument) return undefined;
	const quoted = (argument.startsWith('"') && argument.endsWith('"')) || (argument.startsWith("'") && argument.endsWith("'"));
	return quoted ? argument.slice(1, -1) : argument;
}

export function isRelayCall(toolName: string, input: Record<string, unknown>): boolean {
	return toolName === "bash" && typeof input.command === "string" && relayDocumentPath(input.command) !== undefined;
}

export function opensRelayWindow(command: string): boolean {
	const document = relayDocumentPath(command);
	return document !== undefined && !document.startsWith("-");
}

function documentsToScan(command: string): string[] {
	const document = relayDocumentPath(command);
	return document ? [document] : [];
}

export default function relay(pi: ExtensionAPI) {
	pi.on("resources_discover", () => ({ skillPaths: [skillsDir] }));
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections.relay_clear = clearPrompt;
	});
	pi.on("session_start", () => {
		pi.events.emit("auto-mode:trust", { name: "relay", allows: isRelayCall, alone: true, guidance: WHEN_DENIED });
		pi.events.emit("secret-scanner:paths", { name: "relay", paths: documentsToScan });
		pi.events.emit("background-bash:hold", { name: "relay", matches: opensRelayWindow, foreground: FOREGROUND_RELAY, open: RELAY_OPEN });
	});
}

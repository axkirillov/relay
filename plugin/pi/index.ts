import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "..", "skills");
const clearPrompt = readFileSync(join(here, "clear.md"), "utf8");

export default function relay(pi: ExtensionAPI) {
	pi.on("resources_discover", () => ({ skillPaths: [skillsDir] }));
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections.relay_clear = clearPrompt;
	});
}

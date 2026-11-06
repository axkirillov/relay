import { fileURLToPath } from "node:url";
import { answer, askInRelay, readHookInput } from "./window.mjs";

const otherLabel = "Other:";

export function questionDocument(questions) {
  const parts = ["# Claude asks", ""];
  questions.forEach((question, index) => {
    parts.push(`## ${index + 1}. ${question.question}`, "");
    parts.push(question.multiSelect ? "Tick any." : "Tick one.", "");
    for (const option of question.options ?? []) {
      parts.push(`- [ ] ${option.label}${option.description ? ` — ${option.description}` : ""}`);
    }
    parts.push("", otherLabel, "", "");
  });
  return parts.join("\n");
}

export function answersFrom(text, questions) {
  const sections = text.split(/^## \d+\. /m).slice(1);
  const answers = {};
  questions.forEach((question, index) => {
    const section = sections[index] ?? "";
    const ticked = (question.options ?? [])
      .filter((option) => section.split("\n").some((line) => tickedLine(line, option.label)))
      .map((option) => option.label);
    const other = section.split(otherLabel).slice(1).join(otherLabel).trim();
    const chosen = [...ticked, ...(other ? [other] : [])];
    if (chosen.length) answers[question.question] = chosen.join(", ");
  });
  return answers;
}

function tickedLine(line, label) {
  const match = /^\s*[-*] \[[xX]\] (.*)$/.exec(line);
  return !!match && (match[1] === label || match[1].startsWith(`${label} — `));
}

export async function decide(input, ask = askInRelay) {
  const questions = input.tool_input?.questions ?? [];
  const reply = await ask(questionDocument(questions), input.cwd);
  if (!reply.accepted) return deny("The user closed the relay window without answering.");
  const answers = answersFrom(reply.text, questions);
  if (!Object.keys(answers).length) return deny("The user accepted the relay window without answering.");
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...input.tool_input, answers },
    },
  };
}

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) answer(await decide(await readHookInput()));

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { answer, askInRelay, readHookInput } from "./window.mjs";

const otherLabel = "Other:";

const quoteLimit = 1200;

export function questionDocument(questions, context = {}) {
  const parts = ["# Claude asks", ""];
  parts.push(`Claude, working in \`${context.cwd ?? "?"}\`, stopped to ask you ${questions.length === 1 ? "a question" : `${questions.length} questions`}.`);
  parts.push("Tick your answers, or write your own under *Other*, then accept.", "");
  if (context.prompt) parts.push("Your last message to it:", "", quoted(context.prompt), "");
  if (context.said) parts.push("What it said before asking:", "", quoted(context.said), "");
  questions.forEach((question, index) => {
    parts.push(`## ${index + 1}. ${question.question}`, "");
    if (question.header) parts.push(`*${question.header}*`, "");
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

function quoted(text) {
  const clipped = text.length > quoteLimit ? `${text.slice(0, quoteLimit)}…` : text;
  return clipped.trim().split("\n").map((line) => `> ${line}`).join("\n");
}

export function conversationContext(transcriptPath) {
  let lines;
  try {
    lines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  } catch {
    return {};
  }
  let prompt;
  const said = [];
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (entry.type === "user" && !entry.isMeta) {
      const text = typeof content === "string" ? content : (content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
      if (text.trim()) {
        prompt = text;
        said.length = 0;
      }
    } else if (entry.type === "assistant" && Array.isArray(content)) {
      for (const part of content) if (part.type === "text" && part.text.trim()) said.push(part.text);
    }
  }
  return { prompt, said: said.join("\n\n") || undefined };
}

function tickedLine(line, label) {
  const match = /^\s*[-*] \[[xX]\] (.*)$/.exec(line);
  return !!match && (match[1] === label || match[1].startsWith(`${label} — `));
}

export async function decide(input, ask = askInRelay) {
  const questions = input.tool_input?.questions ?? [];
  const context = { cwd: input.cwd, ...conversationContext(input.transcript_path) };
  const reply = await ask(questionDocument(questions, context), input.cwd);
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

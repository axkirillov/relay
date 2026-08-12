import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import { commandOf, isShellLang, shellBlockAt, startOutput } from "./runblock.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function stateOf(doc: string) {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
}

/** `|` is the cursor. What would run with it there, or null if nothing would. */
function withCursor(marked: string): string | null {
  const pos = marked.indexOf("|");
  const state = stateOf(marked.replace("|", ""));
  return shellBlockAt(state, pos)?.command ?? null;
}

/** The document after a run has been set up, with `→` where output will land. */
function planned(marked: string): string {
  const pos = marked.indexOf("|");
  const doc = marked.replace("|", "");
  const state = stateOf(doc);
  const block = shellBlockAt(state, pos)!;
  const plan = startOutput(state, block);
  const after = doc.slice(0, plan.from) + plan.insert + doc.slice(plan.to);
  return `${after.slice(0, plan.at)}→${after.slice(plan.at)}`;
}

// --- which fences are commands -----------------------------------------------
check("sh runs", isShellLang("sh"), true);
check("bash runs", isShellLang("bash"), true);
check("zsh runs", isShellLang("zsh"), true);
check("shell runs", isShellLang("shell"), true);
check("console runs", isShellLang("console"), true);
check("case is not the point", isShellLang("Bash"), true);
check("an attribute after the language is not the language", isShellLang("sh title=build"), true);
check("js does not run", isShellLang("js"), false);
check("python does not run", isShellLang("python"), false);
check("a fence with no language does not run", isShellLang(""), false);

// --- the prompt is not part of the command -----------------------------------
check("a $ prompt comes off", commandOf("$ pnpm test"), "pnpm test");
check("a % prompt comes off", commandOf("% pnpm test"), "pnpm test");
check("every line of a session", commandOf("$ cd ui\n$ pnpm test"), "cd ui\npnpm test");
check("a variable is not a prompt", commandOf("$HOME/bin/thing"), "$HOME/bin/thing");
check("a prompt behind indentation still comes off", commandOf("  $ echo hi"), "echo hi");
// A shell script means its indentation; only the ends of the block are trimmed.
check(
  "indentation inside a script survives",
  commandOf("for f in *; do\n  echo $f\ndone"),
  "for f in *; do\n  echo $f\ndone",
);
check("nothing to strip, nothing changed", commandOf("git status"), "git status");

// --- finding the block the cursor is in --------------------------------------
check("cursor in the command", withCursor("a\n\n```sh\npnpm |test\n```\n"), "pnpm test");
check("cursor on the opening fence", withCursor("a\n\n``|`sh\npnpm test\n```\n"), "pnpm test");
check("cursor on the closing fence", withCursor("a\n\n```sh\npnpm test\n``|`\n"), "pnpm test");
check("cursor at the very start of the fence", withCursor("a\n\n|```sh\npnpm test\n```\n"), "pnpm test");
check("cursor in the prose", withCursor("a|\n\n```sh\npnpm test\n```\n"), null);
check("cursor below the block", withCursor("```sh\npnpm test\n```\n\nta|il\n"), null);
check("a js block is not a command", withCursor("```js\nlet x = |1\n```\n"), null);
check("an empty block has nothing to run", withCursor("```sh\n|\n```\n"), null);
check("a session block, prompts stripped", withCursor("```console\n$ git |status\n```\n"), "git status");
check("a script runs as a script", withCursor("```sh\ncd ui\npnpm |test\n```\n"), "cd ui\npnpm test");
check(
  "the right block, of several",
  withCursor("```sh\nfirst\n```\n\n```sh\nsec|ond\n```\n"),
  "second",
);

// --- where the output goes ---------------------------------------------------
check(
  "output lands under the command",
  planned("```sh\npnpm |test\n```\n"),
  "```sh\npnpm test\n```\n\n````output\n→````\n",
);
check(
  "and above whatever followed it",
  planned("```sh\npnpm |test\n```\n\ntail\n"),
  "```sh\npnpm test\n```\n\n````output\n→````\n\ntail\n",
);
check(
  "a second run replaces the first",
  planned("```sh\npnpm |test\n```\n\n````output\nold news\n````\n\ntail\n"),
  "```sh\npnpm test\n```\n\n````output\n→````\n\ntail\n",
);
check(
  "an output block further down is somebody else's",
  planned("```sh\npnpm |test\n```\n\nprose\n\n````output\nnot mine\n````\n"),
  "```sh\npnpm test\n```\n\n````output\n→````\n\nprose\n\n````output\nnot mine\n````\n",
);
check(
  "another command's block is not an output block",
  planned("```sh\npnpm |test\n```\n\n```sh\nsomething else\n```\n"),
  "```sh\npnpm test\n```\n\n````output\n→````\n\n```sh\nsomething else\n```\n",
);

process.exit(fails ? 1 : 0);

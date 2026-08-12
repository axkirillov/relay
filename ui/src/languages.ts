import { type Language, StreamLanguage, type StreamParser } from "@codemirror/language";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { c, cpp, csharp, java, kotlin, objectiveC, scala } from "@codemirror/legacy-modes/mode/clike";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";

/**
 * Which languages a fenced block can be written in.
 *
 * Not `@codemirror/language-data`. That knows every language CodeMirror has and
 * loads each one on demand, but the demand-loading is what makes it affordable —
 * and the editor is bundled as a single IIFE, which cannot split code, so esbuild
 * inlines every one of those `import()`s eagerly. Measured: 1.5mb of parser
 * tables, to spell Fortran in a document two people write notes in.
 *
 * So the languages are picked by hand, by one rule: a language earns a place if a
 * relay document is likely to carry a block of it. There are two tiers, because
 * the cost differs by two orders of magnitude — a lezer grammar is 10–90kb of
 * compiled tables, a CodeMirror 5 stream mode is one or two. Which is why the
 * cheap tier is generous and the expensive one is not: Rust and Go are here
 * because this machine writes them, Haskell is not.
 *
 * Adding a stream mode is one import and one line, for ~1kb. Say the word.
 *
 * Markdown is deliberately absent, though it costs nothing and is already a
 * dependency: nesting it would give a ` ```md ` fence real headings, at heading
 * size, inside a code block — the block would stop looking like source, which is
 * the one thing a fence is for.
 */
const table: Array<[() => Language, ...string[]]> = [
  // A single grammar in four configurations; the tables are shared between them.
  [() => javascript().language, "javascript", "js", "mjs", "cjs", "node"],
  [() => javascript({ jsx: true }).language, "jsx"],
  [() => javascript({ typescript: true }).language, "typescript", "ts", "mts", "cts"],
  [() => javascript({ typescript: true, jsx: true }).language, "tsx"],
  [() => json().language, "json", "jsonc", "json5"],
  [() => python().language, "python", "py", "python3"],
  [() => css().language, "css"],
  [() => html().language, "html", "htm"],
  [() => xml().language, "xml", "svg", "plist"],
  [() => yaml().language, "yaml", "yml"],
  [() => sql().language, "sql", "mysql", "psql", "postgres", "postgresql", "sqlite"],
  [() => rust().language, "rust", "rs"],
  [() => go().language, "go", "golang"],
  // `console` and `shell-session` are transcripts rather than scripts; the mode
  // reads the prompt as part of the line either way, which is what you want.
  [() => stream(shell), "shell", "sh", "bash", "zsh", "console", "shell-session"],
  [() => stream(diff), "diff", "patch"],
  [() => stream(toml), "toml"],
  [() => stream(dockerFile), "dockerfile", "docker"],
  [() => stream(properties), "ini", "properties", "env", "dotenv"],
  [() => stream(c), "c", "h"],
  [() => stream(cpp), "cpp", "c++", "cc", "cxx", "hpp"],
  [() => stream(java), "java"],
  [() => stream(kotlin), "kotlin", "kt"],
  [() => stream(scala), "scala"],
  [() => stream(csharp), "csharp", "cs"],
  [() => stream(objectiveC), "objectivec", "objc"],
];

function stream(parser: StreamParser<unknown>): Language {
  return StreamLanguage.define(parser);
}

const byName = new Map<string, () => Language>();
for (const [make, ...names] of table) for (const name of names) byName.set(name, make);

// Built on first use and kept, rather than all of them at boot: a document with
// no code in it should pay for none of this, and two aliases of one language
// share a factory, so they share the parser it builds.
const built = new Map<() => Language, Language>();

/**
 * The language a fence's info string names, if it names one this editor has.
 *
 * `@codemirror/lang-markdown` has already cut the info string down to its first
 * word by the time this is called — ` ```ts {1,3} ` arrives as `ts` — so the only
 * thing left to normalise is case.
 */
export function codeLanguage(info: string): Language | null {
  const make = byName.get(info.trim().toLowerCase());
  if (!make) return null;
  let lang = built.get(make);
  if (!lang) built.set(make, (lang = make()));
  return lang;
}

/** Every info string that names a language, for the record and for the tests. */
export const fenceNames: string[] = [...byName.keys()];

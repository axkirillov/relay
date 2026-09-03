import { type Language, StreamLanguage, type StreamParser } from "@codemirror/language";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { c, cpp, csharp, java, kotlin, objectiveC, scala } from "@codemirror/legacy-modes/mode/clike";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";

const table: Array<[() => Language, ...string[]]> = [
  [() => javascript().language, "javascript", "js", "mjs", "cjs", "node"],
  [() => javascript({ jsx: true }).language, "jsx"],
  [() => javascript({ typescript: true }).language, "typescript", "ts", "mts", "cts"],
  [() => javascript({ typescript: true, jsx: true }).language, "tsx"],
  [() => json().language, "json", "jsonc", "json5"],
  [() => python().language, "python", "py", "python3"],
  [() => php({ plain: true }).language, "php"],
  [() => css().language, "css"],
  [() => html().language, "html", "htm"],
  [() => xml().language, "xml", "svg", "plist"],
  [() => yaml().language, "yaml", "yml"],
  [() => sql().language, "sql", "mysql", "psql", "postgres", "postgresql", "sqlite"],
  [() => rust().language, "rust", "rs"],
  [() => go().language, "go", "golang"],
  [() => stream(shell), "shell", "sh", "bash", "zsh", "console", "shell-session"],
  [() => stream(silent), "diff", "patch"],
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

const silent: StreamParser<unknown> = {
  token: (stream) => {
    stream.skipToEnd();
    return null;
  },
};

const byName = new Map<string, () => Language>();
for (const [make, ...names] of table) for (const name of names) byName.set(name, make);

const built = new Map<() => Language, Language>();

export function codeLanguage(info: string): Language | null {
  const make = byName.get(info.trim().toLowerCase());
  if (!make) return null;
  let lang = built.get(make);
  if (!lang) built.set(make, (lang = make()));
  return lang;
}

export function languageForPath(path: string): Language | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return codeLanguage(dot === -1 ? name : name.slice(dot + 1));
}

export const fenceNames: string[] = [...byName.keys()];

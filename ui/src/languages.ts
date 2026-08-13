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
 * PHP is in the expensive tier by necessity rather than by preference: the mixed
 * modes were left out of `@codemirror/legacy-modes`, so there is no cheap php on
 * offer at any price. Measured at 95kb of the bundle — the largest grammar in
 * here by a good margin — asked for and granted, because it is the language the
 * diffs being reviewed on this machine are written in, and a review that cannot
 * highlight the code it is a review of is the feature missing its point.
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
  // `plain`, so that parsing starts at the first character rather than at the
  // first `<?`. A whole .php file opens with that marker, but a fragment of one —
  // which is what every hunk of a patch is, and most of what a fence carries —
  // does not, and without `plain` every such fragment is read as HTML text and
  // comes back with not one token in it. Measured: 38 tokens against 0 on the
  // same nine lines. The cost is that `<?php` itself is read as punctuation, and
  // that a template mixing php into html loses its tag names; both are a great
  // deal cheaper than the alternative.
  [() => php({ plain: true }).language, "php"],
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

/**
 * A language that says nothing about its own text.
 *
 * What a ```diff fence needs from this table is not a diff mode but the absence
 * of one: diffview.ts paints inside the block, in the language of the file the
 * patch touches, and a mode that knows only `+` and `-` would be fighting it for
 * the same characters — the two of them colouring one line, and the winner
 * decided by which span ended up inside the other.
 *
 * Two absences are on offer and they are not the same. With no entry at all, the
 * markdown parser keeps the body as its own `CodeText`, which is tagged
 * monospace, which is green: every line of every patch, green, before anything
 * else is painted. Mounting a parser that emits no tokens replaces that node
 * instead — see the note in fence.ts on what a mounted node does to the tag
 * underneath — and hands the block over as bare text.
 */
const silent: StreamParser<unknown> = {
  token: (stream) => {
    stream.skipToEnd();
    return null;
  },
};

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

/**
 * The language a file is written in, going by its name.
 *
 * For a patch, which names the files it changes and nothing else about them. The
 * extension is looked up in the same table the fences use, which needs no second
 * list because that table is already spelled in extensions — `ts`, `py`, `rs` are
 * both what a fence says and what a file ends in. Where they part company it is
 * the fence that has the extra spellings (`typescript`, `golang`), and an unused
 * key costs nothing.
 *
 * A file with no extension is named for what it is — `Dockerfile` — so the whole
 * name is the only thing left to ask about.
 */
export function languageForPath(path: string): Language | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return codeLanguage(dot === -1 ? name : name.slice(dot + 1));
}

/** Every info string that names a language, for the record and for the tests. */
export const fenceNames: string[] = [...byName.keys()];

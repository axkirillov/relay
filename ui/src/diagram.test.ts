import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { failure, mermaidFences, sourceLine } from "./diagram.ts";
import { codeLanguage } from "./languages.ts";

function parsed(doc: string) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, codeLanguages: codeLanguage })],
  });
}

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function fences(doc: string) {
  return mermaidFences(parsed(doc)).map((f) => [doc.slice(f.from, f.to), f.code]);
}

check("fences: none in prose", fences("# hi\n\nclassDiagram\n"), []);
check("fences: a mermaid fence", fences("text\n\n```mermaid\nclassDiagram\n  A <|-- B\n```\n"), [
  ["```mermaid\nclassDiagram\n  A <|-- B\n```", "classDiagram\n  A <|-- B"],
]);
check("fences: another language is not a diagram", fences("```ts\nlet a = 1\n```\n"), []);
check("fences: the first word of the info decides", fences("```mermaid title\nflowchart TD\n```\n"), [
  ["```mermaid title\nflowchart TD\n```", "flowchart TD"],
]);
check("fences: case does not matter", fences("```Mermaid\npie\n```\n"), [["```Mermaid\npie\n```", "pie"]]);
check("fences: a tilde fence", fences("~~~mermaid\npie\n~~~\n"), [["~~~mermaid\npie\n~~~", "pie"]]);
check("fences: an empty fence has no code", fences("```mermaid\n```\n"), [["```mermaid\n```", ""]]);
check("fences: mermaidx is not mermaid", fences("```mermaidx\npie\n```\n"), []);
check("fences: two, in order", fences("```mermaid\npie\n```\n\n```mermaid\nflowchart TD\n```\n"), [
  ["```mermaid\npie\n```", "pie"],
  ["```mermaid\nflowchart TD\n```", "flowchart TD"],
]);

const classBody = "classDiagram\n  class A {\n  A <|-- B";

check("line: nothing stripped", sourceLine("flowchart TD\n  A --> B\n  B --> (", 3), 3);
check("line: a directive line above", sourceLine(`%%{init: {"theme":"dark"}}%%\n${classBody}`, 3), 4);
check("line: front matter above", sourceLine(`---\nconfig:\n  theme: dark\n---\n${classBody}`, 3), 7);
check("line: a comment line in between", sourceLine("flowchart TD\n  %% a note\n  A --> B\n  B --> (", 3), 4);
check(
  "line: blank lines swallowed with the comments",
  sourceLine("\n\n%% first\nflowchart TD\n  A --> B\n\n  %% gap above\n  B --> (", 3),
  8,
);
check(
  "line: a directive mid-diagram leaves its line",
  sourceLine(`flowchart TD\n  A --> B\n  %%{init: {"theme":"dark"}}%%\n  B --> (`, 4),
  4,
);
check("line: past the end is the last line", sourceLine("sequenceDiagram\n  A->>B: hi\n  loop", 5), 3);
check("line: the line after the last is the last line", sourceLine("sequenceDiagram\n  A->>B: hi\n  loop", 4), 3);

const parseError =
  "Parse error on line 3:\n...ass A {  A <|-- B\n--------------------^\nExpecting 'STRUCT_STOP', 'MEMBER', got 'EOF_IN_STRUCT'";

check(
  "failure: a parse error names the document's line",
  failure(parseError, classBody, 10),
  "diagram not drawn — line 13: Expecting 'STRUCT_STOP', 'MEMBER', got 'EOF_IN_STRUCT'",
);
check(
  "failure: the line skips a directive",
  failure(parseError, `%%{init: {"theme":"dark"}}%%\n${classBody}`, 10),
  "diagram not drawn — line 14: Expecting 'STRUCT_STOP', 'MEMBER', got 'EOF_IN_STRUCT'",
);
check(
  "failure: a lexical error",
  failure("Lexical error on line 2. Unrecognized text.\n...A --> B\n-----^", "flowchart TD\n  A --> B", 4),
  "diagram not drawn — line 6: Unrecognized text.",
);
check(
  "failure: a parse error on one line",
  failure("Parse error on line 2: Unexpected 'end of input'", "flowchart TD\n  A -->", 1),
  "diagram not drawn — line 3: Unexpected 'end of input'",
);
check(
  "failure: a Langium error has every line mapped and its newline shown",
  failure(
    "Parsing failed: Lexer error on line 2, column 8: unexpected character: ->x<- at offset: 11, skipped 1 characters. Parse error on line 2, column 9: Expecting token of type 'NUMBER_PIE' but found `\n`.",
    'pie\n  "a": x',
    20,
  ),
  "diagram not drawn — Parsing failed: Lexer error on line 22, column 8: unexpected character: ->x<- at offset: 11, skipped 1 characters. Parse error on line 22, column 9: Expecting token of type 'NUMBER_PIE' but found `\\n`.",
);
check(
  "failure: an unknown kind of diagram",
  failure("No diagram type detected matching given configuration for text: classDiagarm\n  A <|-- B", "classDiagarm\n  A <|-- B", 1),
  "diagram not drawn — No diagram type detected",
);
check(
  "failure: anything else keeps its first line",
  failure("mermaid.js did not load", "pie", 1),
  "diagram not drawn — mermaid.js did not load",
);
check("failure: no message at all", failure("", "pie", 1), "diagram not drawn — Mermaid gave no reason");

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);

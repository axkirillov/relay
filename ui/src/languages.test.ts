import { syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { highlightTree, type Tag, tags as t } from "@lezer/highlight";
import { codeLines } from "./fence.ts";
import { codeLanguage, fenceNames, languageForPath } from "./languages.ts";
import { highlightStyle } from "./theme.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function state(doc: string) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, codeLanguages: codeLanguage })],
  });
}

const roles: Array<[string, Tag]> = [
  ["keyword", t.keyword],
  ["string", t.string],
  ["number", t.number],
  ["comment", t.comment],
  ["type", t.typeName],
  ["fn", t.propertyName],
  ["builtin", t.standard(t.variableName)],
  ["name", t.variableName],
  ["tag", t.tagName],
  ["attr", t.attributeName],
  ["punct", t.punctuation],
  ["mark", t.processingInstruction],
  ["lang", t.labelName],
  ["code", t.monospace],
  ["heading", t.heading1],
];

const named = new Map<string, string>();
for (const [role, tag] of roles) {
  const cls = highlightStyle.style([tag]);
  if (cls && !named.has(cls)) named.set(cls, role);
}

function tokens(doc: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  highlightTree(syntaxTree(state(doc)), highlightStyle, (from, to, cls) => {
    out.push([doc.slice(from, to), named.get(cls) ?? cls]);
  });
  return out;
}

function inside(doc: string): string[] {
  const seen = new Set<string>();
  for (const [text, role] of tokens(doc)) {
    if (text.startsWith("```") || role === "lang") continue;
    seen.add(role);
  }
  return [...seen].sort();
}

check("names: ts", codeLanguage("ts") !== null, true);
check("names: case is not part of it", codeLanguage("TS") !== null, true);
check("names: padding is not part of it", codeLanguage("  bash  ") !== null, true);
check("names: an alias is the same language", codeLanguage("ts") === codeLanguage("typescript"), true);
check("names: built once and kept", codeLanguage("python") === codeLanguage("python"), true);
check("names: tsx is not ts", codeLanguage("tsx") === codeLanguage("ts"), false);
check("names: a language we do not have", codeLanguage("fortran"), null);
check("names: nothing at all", codeLanguage(""), null);
check("names: all of them resolve", fenceNames.filter((n) => !codeLanguage(n)), []);

check("path: an extension names the language", languageForPath("src/run.ts") === codeLanguage("ts"), true);
check("path: a directory is not an extension", languageForPath("api/v2/Order.php") === codeLanguage("php"), true);
check("path: case is not part of it", languageForPath("App/Order.PHP") === codeLanguage("php"), true);
check("path: two dots, the last one counts", languageForPath("ui/src/take.test.ts") === codeLanguage("ts"), true);
check("path: no extension at all", languageForPath("docker/Dockerfile") === codeLanguage("docker"), true);
check("path: a dotfile is its own extension", languageForPath(".env") === codeLanguage("env"), true);
check("path: a language we do not have", languageForPath("README.md"), null);
check("path: nothing to go on", languageForPath("Makefile"), null);

check(
  "ts: every token of a declaration",
  tokens("```ts\nconst n: number = 1; // why\n```\n"),
  [
    ["```", "mark"],
    ["ts", "lang"],
    ["const", "keyword"],
    ["n", "name"],
    [":", "punct"],
    ["number", "type"],
    ["=", "punct"],
    ["1", "number"],
    [";", "punct"],
    ["// why", "comment"],
    ["```", "mark"],
  ],
);

check("js: a keyword is a keyword", inside("```js\nfunction f() { return 1 }\n```\n").includes("keyword"), true);
check("tsx: highlights", inside("```tsx\nconst a = <p>hi</p>;\n```\n").includes("keyword"), true);
check("python: comment and string", inside("```python\nx = 'hi'  # note\n```\n"), [
  "comment",
  "name",
  "punct",
  "string",
]);
check("json: a key is not a string", inside('```json\n{"a": 1}\n```\n'), ["fn", "number", "punct"]);
check("yaml: a key is not a string", inside("```yaml\na: hi\n```\n").includes("fn"), true);
check("css: a property", inside("```css\na { color: red }\n```\n").includes("fn"), true);
check("html: tag and attribute", inside('```html\n<a href="x">hi</a>\n```\n'), [
  "attr",
  "punct",
  "string",
  "tag",
]);
check("sql: a keyword", inside("```sql\nselect 1 from t\n```\n").includes("keyword"), true);
check("rust: a keyword", inside("```rust\nfn main() {}\n```\n").includes("keyword"), true);
check("go: a keyword", inside("```go\nfunc main() {}\n```\n").includes("keyword"), true);
check("php: a fragment is php and not html", inside("```php\npublic function id(): int\n```\n"), [
  "keyword",
  "name",
  "punct",
  "type",
]);
check("php: a variable", inside("```php\n$order = null;\n```\n").includes("name"), true);

check("bash: a comment", inside("```bash\n# note\nls -la\n```\n").includes("comment"), true);
check("bash: sh is the same mode", inside("```sh\n# note\n```\n").includes("comment"), true);
check("diff: the body carries no tokens of its own", inside("```diff\n+added\n-gone\n```\n"), []);
check("diff: patch is the same", inside("```patch\n+added\n```\n"), []);
check("diff: a blank line does not stall the parser", inside("```diff\n+a\n\n+b\n```\n"), []);
check("toml: a key", inside('```toml\na = "hi"\n```\n').includes("string"), true);
check("dockerfile: a keyword", inside("```dockerfile\nFROM alpine\n```\n").includes("keyword"), true);
check("c: a keyword", inside("```c\nif (x) return 1;\n```\n").includes("keyword"), true);
check("c: a type", inside("```c\nint n = 1;\n```\n").includes("type"), true);
check("java: a keyword", inside("```java\nclass A {}\n```\n").includes("keyword"), true);

check("unknown: falls back to plain code", tokens("```fortran\nprint *, 1\n```\n"), [
  ["```", "mark"],
  ["fortran", "lang"],
  ["print *, 1", "code"],
  ["```", "mark"],
]);
check("unknown: a fence with no language at all", tokens("```\nplain\n```\n"), [
  ["```", "mark"],
  ["plain", "code"],
  ["```", "mark"],
]);

check(
  "markdown: a heading beside a fence keeps its own tags",
  tokens("# hi\n\n```ts\nlet a = 1\n```\n").filter(([, role]) => role === "heading" || role === "keyword"),
  [
    [" hi", "heading"],
    ["let", "keyword"],
  ],
);
check("markdown: inline code is still inline code", tokens("a `x` b"), [
  ["`", "mark"],
  ["x", "code"],
  ["`", "mark"],
]);

const fence = "text\n\n```ts\nlet a = 1\n\nlet b = 2\n```\n\nafter\n";
check("tint: the whole fence, blank line and all", codeLines(state(fence), 0, fence.length), [3, 4, 5, 6, 7]);
check("tint: nothing when there is no code", codeLines(state("just prose\n"), 0, 11), []);
check("tint: an indented block counts as code", codeLines(state("text\n\n    indented\n"), 0, 22), [3]);
check("tint: clipped to the range asked for", codeLines(state(fence), 0, 20), [3, 4]);
check(
  "tint: two fences are two blocks",
  codeLines(state("```ts\na\n```\n\nmid\n\n```sh\nb\n```\n"), 0, 100),
  [1, 2, 3, 7, 8, 9],
);

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);

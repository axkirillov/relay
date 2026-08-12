import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { bannedAttr, bannedTag, blocks, escapeHtml, localSrc, tagBalance } from "./render.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/** What `blocks()` finds, as [kind, source text] — the shape that matters. */
function found(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  return blocks(state).map((b) => [b.kind, doc.slice(b.from, b.to)]);
}

/** The HTML a block would be rendered from. */
function html(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  return blocks(state).map((b) => b.html);
}

// --- what is banned ----------------------------------------------------------
check("tag: script", bannedTag("script"), true);
check("tag: SCRIPT is the same tag", bannedTag("SCRIPT"), true);
check("tag: iframe", bannedTag("iframe"), true);
check("tag: svg stays — it is the point", bannedTag("svg"), false);
check("tag: details stays", bannedTag("details"), false);
check("tag: table stays", bannedTag("table"), false);

check("attr: onclick", bannedAttr("onclick", "boom()"), true);
check("attr: ONLOAD", bannedAttr("ONLOAD", "boom()"), true);
check("attr: srcdoc", bannedAttr("srcdoc", "<p>"), true);
check("attr: javascript: href", bannedAttr("href", "javascript:boom()"), true);
check("attr: javascript: href, padded", bannedAttr("href", "  JavaScript:boom()"), true);
check("attr: data:text/html src", bannedAttr("src", "data:text/html,<script>"), true);
check("attr: data:image/png src is fine", bannedAttr("src", "data:image/png;base64,iVB"), false);
check("attr: plain href", bannedAttr("href", "https://example.com"), false);
check("attr: class", bannedAttr("class", "anything"), false);

check("escape: angle brackets and quotes", escapeHtml(`<a href="x">&`), "&lt;a href=&quot;x&quot;&gt;&amp;");

// --- which image sources name a file on disk ---------------------------------
check("local: absolute path", localSrc("/tmp/a.png"), true);
check("local: relative path", localSrc("shots/a.png"), true);
check("local: padded path", localSrc("  /tmp/a.png  "), true);
check("local: https is not local", localSrc("https://example.com/a.png"), false);
check("local: data is not local", localSrc("data:image/png;base64,iVB"), false);
check("local: protocol-relative is not local", localSrc("//example.com/a.png"), false);
check("local: fragment is not a file", localSrc("#a"), false);
check("local: nothing at all", localSrc(""), false);

// --- tag balance -------------------------------------------------------------
check("balance: closed", tagBalance("<div>hi</div>"), 0);
check("balance: left open", tagBalance("<div>"), 1);
check("balance: closes what it never opened", tagBalance("</div>"), -1);
check("balance: self-closing", tagBalance("<svg><path d='M0 0'/></svg>"), 0);
check("balance: void tag", tagBalance("<p>a<br>b</p>"), 0);
check("balance: unclosed li is not unbalanced", tagBalance("<ul><li>a<li>b</ul>"), 0);
check("balance: comment is not a tag", tagBalance("<!-- <div> -->"), 0);
check("balance: > inside an attribute", tagBalance(`<div title="a > b"></div>`), 0);

// --- what counts as a block --------------------------------------------------
check("blocks: nothing to render", found("# hi\n\njust prose\n"), []);

check("blocks: a table", found("| a | b |\n| - | - |\n| 1 | 2 |\n"), [
  ["table", "| a | b |\n| - | - |\n| 1 | 2 |"],
]);

check("blocks: one-piece html", found("<p>hello</p>\n"), [["html", "<p>hello</p>"]]);

// The case that made weld necessary: markdown ends the HTML block at the blank
// line, so this arrives as three nodes with a paragraph in the middle.
check(
  "blocks: welded across a blank line",
  found("<div>\n\nhello\n\n</div>\n"),
  [["html", "<div>\n\nhello\n\n</div>"]],
);

check(
  "blocks: details with markdown inside",
  found("<details>\n<summary>more</summary>\n\ninside\n\n</details>\n"),
  [["html", "<details>\n<summary>more</summary>\n\ninside\n\n</details>"]],
);

// Two finished blocks are two blocks — welding them would merge things the
// author wrote apart.
check("blocks: two closed blocks stay apart", found("<p>one</p>\n\n<p>two</p>\n"), [
  ["html", "<p>one</p>"],
  ["html", "<p>two</p>"],
]);

// Half a tag renders as an empty box, so it stays as the source it was written as.
check("blocks: unbalanced is left alone", found("<div>\n\nhello\n"), []);
check("blocks: a stray closing tag is left alone", found("</div>\n"), []);

// An image on a line of its own is a picture; one inside a sentence is words.
check("blocks: standalone image", found("![cat](cat.png)\n"), [["image", "![cat](cat.png)"]]);
check("blocks: image in a sentence", found("see ![cat](cat.png) there\n"), []);
check("blocks: inline html stays source", found("a <b>bold</b> word\n"), []);

// `svg` is not a tag markdown opens a block for, so a one-line SVG arrives as a
// paragraph — it is still HTML, and still gets drawn.
check("blocks: one-line svg", found('<svg><rect width="4"/></svg>\n'), [
  ["html", '<svg><rect width="4"/></svg>'],
]);
check(
  "blocks: svg split by blank lines is welded",
  found('<svg viewBox="0 0 8 8">\n\n<circle r="3"/>\n\n</svg>\n'),
  [["html", '<svg viewBox="0 0 8 8">\n\n<circle r="3"/>\n\n</svg>']],
);
// Prose at either end means it is a sentence, not a drawing.
check("blocks: tag then prose stays source", found("<b>bold</b> is the word\n"), []);

check("blocks: several, in order", found("<p>one</p>\n\ntext\n\n| a |\n| - |\n| 1 |\n"), [
  ["html", "<p>one</p>"],
  ["table", "| a |\n| - |\n| 1 |"],
]);

// --- the html that comes out -------------------------------------------------
check("html: table becomes a real table", html("| a | b |\n| - | - |\n| 1 | 2 |\n"), [
  "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
]);

check("html: table cells are escaped", html("| a |\n| - |\n| <b> |\n"), [
  "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>&lt;b&gt;</td></tr></tbody></table>",
]);

check("html: local image", html("![cat](cat.png)\n"), [`<img src="cat.png" alt="cat">`]);

// The same src the server keyed its allow-list by, so the lookup can hit.
check("html: angle brackets are markdown, not path", html("![cat](<cat.png>)\n"), [
  `<img src="cat.png" alt="cat">`,
]);

check("html: angle brackets carry a space", html("![cat](<a cat.png>)\n"), [
  `<img src="a cat.png" alt="cat">`,
]);

check("html: a title is not part of the src", html(`![cat](cat.png "a cat")\n`), [
  `<img src="cat.png" alt="cat">`,
]);

// Remote pictures are fetched and shown; the content policy allows images off
// the machine and nothing else.
check("html: remote image", html("![cat](https://x.test/cat.png)\n"), [
  `<img src="https://x.test/cat.png" alt="cat">`,
]);

check("html: protocol-relative image", html("![cat](//x.test/cat.png)\n"), [
  `<img src="//x.test/cat.png" alt="cat">`,
]);

// A quote in the URL would otherwise end the attribute and open whatever
// follows as markup of its own.
check("html: image url is escaped", html(`![c](a.png?q="x)\n`), [
  `<img src="a.png?q=&quot;x" alt="c">`,
]);

check("html: an svg is passed through whole", html('<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>\n'), [
  '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>',
]);

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);

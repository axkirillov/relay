import { url, urlAt } from "./link.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

/** Where a `^` stands in the line below it — how the cursor reads on the page. */
function at(line: string, caret: string) {
  return urlAt(line, caret.indexOf("^"));
}

// --- what the wrapping does --------------------------------------------------
check("bare", at("see https://example.com/x for it",
                 "         ^                      "), "https://example.com/x");
check("an autolink", at("see <https://example.com/x> for it",
                        "          ^                       "), "https://example.com/x");
check("a markdown link", at("[the ticket](https://example.com/x) is where",
                            "                     ^                     "), "https://example.com/x");
check("a markdown link, cursor on the words", at("[the ticket](https://example.com/x) is where",
                                                 "     ^                                     "), "https://example.com/x");
check("backticks", at("see `https://example.com/x` for it",
                      "          ^                       "), "https://example.com/x");
check("quotes", at('open "https://example.com/x" now',
                   '           ^                    '), "https://example.com/x");
check("a table cell", at("| https://example.com/x | the ticket |",
                         "      ^                               "), "https://example.com/x");
check("emphasis", at("**https://example.com/x** is the one",
                     "       ^                            "), "https://example.com/x");
check("the sentence's full stop", at("it is at https://example.com/x.",
                                     "             ^                 "), "https://example.com/x");
check("a comma", at("https://example.com/x, and the other",
                    " ^                                  "), "https://example.com/x");
check("in parentheses", at("(https://example.com/x) is the one",
                           "    ^                             "), "https://example.com/x");

// --- where the address ends is the address's own business --------------------
// A bracket the address opened itself is the address's, and a Wikipedia title
// routinely opens one.
check("brackets of its own", at("see https://en.wikipedia.org/wiki/Fold_(higher-order_function) now",
                                "        ^                                                        "),
      "https://en.wikipedia.org/wiki/Fold_(higher-order_function)");
check("brackets of its own, in a markdown link", at("[fold](https://en.wikipedia.org/wiki/Fold_(higher-order_function))",
                                                    "          ^                                                      "),
      "https://en.wikipedia.org/wiki/Fold_(higher-order_function)");
// It is an address, not a command line: whatever is in it comes back whole and
// goes out as one argument. A backtick is the exception, and markdown's rather
// than a decision — in a document it is a fence around the link far more often
// than it is a character of one.
check("shell characters are part of the address", at("https://example.com/?a=$(whoami);b=&c=x|y",
                                                     "  ^                                     "),
      "https://example.com/?a=$(whoami);b=&c=x");
check("a port and a fragment", at("https://example.com:8080/x#frag now",
                                  "  ^                                "), "https://example.com:8080/x#frag");

// --- the shapes relay opens --------------------------------------------------
check("http", at("http://example.com/x now",
                 "  ^                     "), "http://example.com/x");
check("a file url", at("file:///etc/hosts is there",
                       "   ^                      "), "file:///etc/hosts");
check("mailto", at("write to mailto:someone@example.com now",
                   "            ^                         "), "mailto:someone@example.com");
check("shouting", at("HTTPS://EXAMPLE.COM/X now",
                     "  ^                      "), "HTTPS://EXAMPLE.COM/X");
// A browser's address bar takes it, so this does, and it leaves as https.
check("bare www", at("see www.example.com for it",
                     "        ^                 "), "https://www.example.com");
check("a lone www is a word", at("the www. thing is there",
                                 "     ^                 "), null);

// --- where the cursor is -----------------------------------------------------
check("ahead of the cursor", at("see    https://example.com/x",
                                "    ^                       "), "https://example.com/x");
check("on the last character", at("see https://example.com/x",
                                  "                        ^"), "https://example.com/x");
check("past it, on to the next", at("https://a.example.com and https://b.example.com",
                                    "                        ^                     "), "https://b.example.com");
check("behind the cursor is not looked at", at("https://example.com/x is there",
                                               "                        ^     "), null);
check("nothing ahead", at("see    ",
                          "    ^  "), null);
check("an empty line", urlAt("", 0), null);
check("past the end", urlAt("https://example.com/x", 99), null);

// --- what is not a link ------------------------------------------------------
// A path is `gf`'s, and this says nothing about it.
check("a path", at("see src/cli.ts:42 for it",
                   "        ^               "), null);
check("prose alone", at("nothing here to open",
                        "   ^                "), null);

// --- url, on its own ---------------------------------------------------------
// What visual mode hands over, and what `gf` asks to tell a link from a path.
check("url: bare", url("https://example.com/x"), "https://example.com/x");
check("url: wrapped", url("<https://example.com/x>."), "https://example.com/x");
check("url: nothing", url(""), null);
check("url: only punctuation", url("..."), null);
check("url: a path", url("src/cli.ts"), null);
check("url: a word", url("example"), null);
// The two schemes the allow-list exists for.
check("url: javascript", url("javascript:alert(1)"), null);
check("url: data", url("data:text/html,<script>boom()</script>"), null);

process.exit(fails ? 1 : 0);

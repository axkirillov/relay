import { url, urlAt } from "./link.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function at(line: string, caret: string) {
  return urlAt(line, caret.indexOf("^"));
}

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

check("brackets of its own", at("see https://en.wikipedia.org/wiki/Fold_(higher-order_function) now",
                                "        ^                                                        "),
      "https://en.wikipedia.org/wiki/Fold_(higher-order_function)");
check("brackets of its own, in a markdown link", at("[fold](https://en.wikipedia.org/wiki/Fold_(higher-order_function))",
                                                    "          ^                                                      "),
      "https://en.wikipedia.org/wiki/Fold_(higher-order_function)");
check("shell characters are part of the address", at("https://example.com/?a=$(whoami);b=&c=x|y",
                                                     "  ^                                     "),
      "https://example.com/?a=$(whoami);b=&c=x");
check("a port and a fragment", at("https://example.com:8080/x#frag now",
                                  "  ^                                "), "https://example.com:8080/x#frag");

check("http", at("http://example.com/x now",
                 "  ^                     "), "http://example.com/x");
check("a file url", at("file:///etc/hosts is there",
                       "   ^                      "), "file:///etc/hosts");
check("mailto", at("write to mailto:someone@example.com now",
                   "            ^                         "), "mailto:someone@example.com");
check("shouting", at("HTTPS://EXAMPLE.COM/X now",
                     "  ^                      "), "HTTPS://EXAMPLE.COM/X");
check("bare www", at("see www.example.com for it",
                     "        ^                 "), "https://www.example.com");
check("a lone www is a word", at("the www. thing is there",
                                 "     ^                 "), null);

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

check("a path", at("see src/cli.ts:42 for it",
                   "        ^               "), null);
check("prose alone", at("nothing here to open",
                        "   ^                "), null);

check("url: bare", url("https://example.com/x"), "https://example.com/x");
check("url: wrapped", url("<https://example.com/x>."), "https://example.com/x");
check("url: nothing", url(""), null);
check("url: only punctuation", url("..."), null);
check("url: a path", url("src/cli.ts"), null);
check("url: a word", url("example"), null);
check("url: javascript", url("javascript:alert(1)"), null);
check("url: data", url("data:text/html,<script>boom()</script>"), null);

process.exit(fails ? 1 : 0);

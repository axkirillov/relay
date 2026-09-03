import { pathAt, target } from "./goto.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function at(line: string, caret: string) {
  return pathAt(line, caret.indexOf("^"));
}

check("bare", at("see src/cli.ts for it",
                 "        ^            "), { path: "src/cli.ts" });
check("backticks", at("see `src/cli.ts` for it",
                      "         ^             "), { path: "src/cli.ts" });
check("a markdown link", at("[the cli](src/cli.ts) is where",
                            "              ^               "), { path: "src/cli.ts" });
check("quotes", at('open "src/cli.ts" now',
                   '          ^          '), { path: "src/cli.ts" });
check("a table cell", at("| `src/pty.ts` | node-pty |",
                         "      ^                    "), { path: "src/pty.ts" });
check("parentheses", at("(src/cli.ts) is the one",
                        "    ^                  "), { path: "src/cli.ts" });
check("the sentence's full stop", at("it is in src/cli.ts.",
                                     "             ^      "), { path: "src/cli.ts" });
check("a comma", at("src/cli.ts, src/pty.ts",
                    " ^                    "), { path: "src/cli.ts" });

check("a line", at("src/cli.ts:42 has it",
                   "   ^                "), { path: "src/cli.ts", line: 42 });
check("a line and a column", at("src/cli.ts:42:7 has it",
                                "   ^                  "), { path: "src/cli.ts", line: 42, col: 7 });
check("a line with the sentence's stop", at("look at src/cli.ts:42.",
                                            "            ^         "), { path: "src/cli.ts", line: 42 });
check("a trailing colon", at("src/cli.ts:42: no",
                             "  ^              "), { path: "src/cli.ts", line: 42 });
check("a dangling colon is not a line", at("src/cli.ts: no",
                                           "  ^           "), { path: "src/cli.ts" });

check("ahead of the cursor", at("see    src/cli.ts",
                                "    ^            "), { path: "src/cli.ts" });
check("on the last character", at("see src/cli.ts",
                                  "             ^"), { path: "src/cli.ts" });
check("nothing ahead", at("see    ",
                          "    ^  "), null);
check("an empty line", pathAt("", 0), null);
check("past the end", pathAt("src/cli.ts", 99), null);

check("an absolute path", at("/etc/hosts is there",
                             "   ^               "), { path: "/etc/hosts" });
check("home", at("~/.relay/queue is there",
                 "  ^                    "), { path: "~/.relay/queue" });
check("a bare name", at("Makefile is there",
                        "  ^              "), { path: "Makefile" });
check("a url stays whole", at("https://example.com/x is there",
                              "         ^                    "), { path: "https://example.com/x" });

check("target: nothing", target(""), null);
check("target: only punctuation", target("..."), null);
check("target: a number alone", target("42"), { path: "42" });
check("target: a date is not a line number", target("2024/12/31"), { path: "2024/12/31" });

process.exit(fails ? 1 : 0);

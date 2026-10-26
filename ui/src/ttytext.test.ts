import { outputBody, overflows, screenText, spilled } from "./ttytext.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
}

const row = (text: string, wrapped = false) => ({ text, wrapped });

check(
  "blank rows around the screen are dropped",
  screenText([row(""), row("  "), row("one  "), row(""), row("two"), row(""), row("   ")]),
  "one\n\ntwo",
);
check("a wrapped row joins the line before it", screenText([row("abc"), row("def", true), row("ghi")]), "abcdef\nghi");
check("an empty screen is empty", screenText([row(""), row("")]), "");

check("a clean exit adds nothing", outputBody("hi", { code: 0, stopped: false, capped: false }), "hi\n");
check("a failure adds its exit code", outputBody("hi", { code: 2, stopped: false, capped: false }), "hi\n\n[exit 2]\n");
check("accept marks the stop", outputBody("hi", "accept"), "hi\n\n[stopped at accept]\n");
check("a stop with no output is only the marker", outputBody("", { code: null, stopped: true, capped: false }), "[stopped]\n");
check("no output and a clean exit says so", outputBody("", { code: 0, stopped: false, capped: false }), "[no output]\n");

const many = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
check("a short screen does not overflow", overflows("a\nb", 40), false);
check("more lines than the window overflow", overflows(many, 40), true);

const kept = spilled(many, 40, "~/logs/run-3.log");
check("the head stays", kept.startsWith("line 1\nline 2\n"), true);
check("the log path is named", kept.includes("~/logs/run-3.log"), true);
check("the hidden lines are counted", kept.includes("… 40 more lines there. The last 20:"), true);
check("the tail stays", kept.endsWith("line 99\nline 100"), true);

process.exit(fails ? 1 : 0);

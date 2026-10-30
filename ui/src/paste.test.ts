import { imageLine, pastedImage } from "./paste.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

function clipboard(...items: { kind: string; type: string }[]): DataTransfer {
  return { items: items.map((item) => ({ ...item, getAsFile: () => item.type })) } as unknown as DataTransfer;
}

check("line: a plain path", imageLine("/Users/a/.relay/tasks/x/paste-1.png"), "![](/Users/a/.relay/tasks/x/paste-1.png)");
check("line: a path with a space is bracketed", imageLine("/Users/a b/paste-1.png"), "![](</Users/a b/paste-1.png>)");

check("clipboard: a screenshot", pastedImage(clipboard({ kind: "file", type: "image/png" })), "image/png");
check(
  "clipboard: the image beside its text",
  pastedImage(clipboard({ kind: "string", type: "text/html" }, { kind: "file", type: "image/png" })),
  "image/png",
);
check(
  "clipboard: cells from a spreadsheet paste as their text, not their picture",
  pastedImage(clipboard({ kind: "string", type: "text/plain" }, { kind: "file", type: "image/png" })),
  null,
);
check("clipboard: text alone is not ours", pastedImage(clipboard({ kind: "string", type: "text/plain" })), null);
check("clipboard: a file that is not an image", pastedImage(clipboard({ kind: "file", type: "application/pdf" })), null);
check("clipboard: nothing", pastedImage(null), null);

process.exit(fails ? 1 : 0);

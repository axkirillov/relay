import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function readHookInput(stream = process.stdin) {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return JSON.parse(text);
}

export function applyDiff(original, diff) {
  if (!diff.split("\n").some((line) => line.startsWith("@@"))) return original;
  const before = original.split("\n");
  const after = [];
  let next = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (hunk) {
      const start = Number(hunk[1]) - (hunk[2] === "0" ? 0 : 1);
      while (next < start) after.push(before[next++]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) after.push(line.slice(1));
    else if (line.startsWith("-")) next++;
    else if (line.startsWith(" ")) after.push(before[next++]);
    else inHunk = false;
  }
  while (next < before.length) after.push(before[next++]);
  return after.join("\n");
}

export function askInRelay(markdown, cwd) {
  const dir = mkdtempSync(join(tmpdir(), "relay-hook-"));
  const file = join(dir, "ask.md");
  writeFileSync(file, markdown);
  return new Promise((resolve) => {
    const child = spawn("relay", [file], { cwd, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    const done = (code) => {
      rmSync(dir, { recursive: true, force: true });
      resolve(code === 0 ? { accepted: true, text: applyDiff(markdown, out) } : { accepted: false });
    };
    child.on("error", () => done(-1));
    child.on("close", done);
  });
}

export function answer(output) {
  process.stdout.write(JSON.stringify(output) + "\n");
}

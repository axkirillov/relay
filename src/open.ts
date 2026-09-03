import { spawn } from "node:child_process";

import { which } from "./edit.ts";

const settleMs = 3_000;

const schemes = new Set(["http:", "https:", "file:", "mailto:"]);

export function openable(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  return schemes.has(url.protocol) ? url.href : null;
}

export function opener(path: string = process.env.PATH ?? ""): string | null {
  return process.platform === "win32" ? null : which(process.platform === "darwin" ? "open" : "xdg-open", path);
}

export function launch(program: string, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(program, [url], { stdio: "ignore", detached: true });
    } catch (err) {
      return reject(err as Error);
    }

    const done = () => {
      clearTimeout(give);
      child.unref();
    };
    const give = setTimeout(() => {
      done();
      resolve();
    }, settleMs);
    give.unref();

    child.once("error", (err) => {
      done();
      reject(err);
    });
    child.once("exit", (code) => {
      done();
      if (code) reject(new Error(`exit ${code}`));
      else resolve();
    });
  });
}

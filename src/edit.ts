import { statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export function locate(path: string, cwd: string): string | null {
  const home = path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
  const file = resolve(cwd, home);
  try {
    statSync(file);
    return file;
  } catch {
    return null;
  }
}

export function argv(file: string, line?: number, col?: number): string[] {
  const at = line === undefined ? [] : [col === undefined ? `+${line}` : `+call cursor(${line},${col})`];
  return [...at, "--", file];
}

export function which(program: string, path: string = process.env.PATH ?? ""): string | null {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const file = join(dir, program);
    try {
      const found = statSync(file);
      if (found.isFile() && found.mode & 0o111) return file;
    } catch {
    }
  }
  return null;
}

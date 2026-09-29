import { statSync } from "node:fs";
import { delimiter, join } from "node:path";

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

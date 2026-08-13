import { statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

/**
 * The file a path in the document names, if there is one.
 *
 * Resolved against the directory relay was run from — the one the agent asked
 * from, and the one a `⌃↵` command runs in — so a path the agent wrote is read
 * the way the agent meant it. `~` is the human's home, as it is everywhere else.
 *
 * There is no allow-list here, and the absence is deliberate. A picture gets one
 * because its path never comes back off the wire and the agent named every file
 * it meant; a path the human's cursor is on comes back off the wire by
 * definition. There is also nothing to protect: this is their own machine, their
 * own key, and they can already run any command they like in this window. Being
 * shown a file is strictly less than that.
 */
export function locate(path: string, cwd: string): string | null {
  const home = path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
  const file = resolve(cwd, home);
  try {
    // A directory counts. nvim opens one as a listing, which is what vim's own
    // `gf` does with it, and `src/` in a document is a place worth being taken to.
    statSync(file);
    return file;
  } catch {
    return null;
  }
}

/**
 * nvim's argv for a file, and where in it to land.
 *
 * `--` because a file whose name begins with a dash is a file, not a switch.
 */
export function argv(file: string, line?: number, col?: number): string[] {
  const at = line === undefined ? [] : [col === undefined ? `+${line}` : `+call cursor(${line},${col})`];
  return [...at, "--", file];
}

/**
 * Where nvim is, or nothing.
 *
 * Looked up here rather than left to the fork, so that a machine without it can
 * be told so in the footer instead of watching a pane open on a process that
 * died before it drew anything.
 */
export function which(program: string, path: string = process.env.PATH ?? ""): string | null {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const file = join(dir, program);
    try {
      const found = statSync(file);
      if (found.isFile() && found.mode & 0o111) return file;
    } catch {
      // Not in this one; try the next.
    }
  }
  return null;
}

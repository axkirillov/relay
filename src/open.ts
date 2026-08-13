import { spawn } from "node:child_process";

// `.ts`, unlike the bundle's own `.js` specifiers: open.ts is loaded straight by
// node in its test, and node resolves what is written.
import { which } from "./edit.ts";

/**
 * A link out of the document and into whatever the machine opens links with.
 *
 * The page is sandboxed — no node, no shell, and the window has no handler for
 * opening one either — so this side of the wire is the only way out to the OS,
 * the same round trip `gf` makes to reach nvim.
 */

/**
 * How long the opener is given before it is taken to have worked.
 *
 * It is asked to hand the link over, not to be a browser, so it comes back in
 * well under this — and when it does, its exit code is worth reporting. A cold
 * browser is the case that runs long, and by then it is plainly working.
 */
const settleMs = 3_000;

/**
 * The four schemes relay will open, and nothing else.
 *
 * An allow-list rather than "anything with a scheme", because `javascript:` and
 * `data:text/html` are exactly what must never be handed on, and naming what is
 * wanted is the only way to be sure of that. This is the renderer's rule too,
 * kept here as well because a URL arriving over the wire is not the renderer's
 * word for anything.
 */
const schemes = new Set(["http:", "https:", "file:", "mailto:"]);

/**
 * The link a request is asking for, if it is one relay will open.
 *
 * What comes back is the parsed address rather than the text that arrived: it
 * has been through a URL parser and written out again, so a tab or a newline
 * smuggled into the middle of it is gone rather than passed on.
 */
export function openable(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  return schemes.has(url.protocol) ? url.href : null;
}

/**
 * What this machine opens a link with, or nothing.
 *
 * Looked up rather than left to the fork, for the reason `which("nvim")` is:
 * a machine without one can be told so in the footer. macOS's `open` is the
 * house rule and `xdg-open` is its counterpart everywhere else; Windows has no
 * program to name here — `start` is the shell's own word — and says so.
 */
export function opener(path: string = process.env.PATH ?? ""): string | null {
  return process.platform === "win32" ? null : which(process.platform === "darwin" ? "open" : "xdg-open", path);
}

/**
 * Hand the link over, and wait long enough to know whether it was taken.
 *
 * One argument, no shell: the address is data, and the only thing between it and
 * `execvp` is an array. No `--` before it either — `xdg-open` has no such
 * convention and would take it for the URL — which costs nothing, because a
 * scheme is the one thing every address here has already been made to start
 * with, and no such address can be read as a switch.
 *
 * Detached and with its output discarded, because what it starts is a browser
 * that will outlive this relay, and a browser's warnings are not relay's stderr.
 *
 * Waiting for it means keeping it, so the child is let go of at the moment the
 * answer is settled and not before: until then it holds this process the way any
 * unfinished work does, and after it there is nothing left to wait for. An
 * `xdg-open` that runs the browser in front of it would otherwise be a relay
 * that cannot exit until the human closes their browser.
 */
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

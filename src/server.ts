import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { argv, locate, which } from "./edit.js";
import { contentType, type Images, localImages } from "./images.js";
import { launch, openable, opener } from "./open.js";
import { page } from "./page.js";
import * as pty from "./pty.js";
import { type Running, start } from "./run.js";

const maxDocBytes = 8 << 20;
// A keystroke, or a paste of something the human had lying around.
const maxInputBytes = 1 << 20;
const maxCommandBytes = 64 << 10;
const bundle = fileURLToPath(new URL("./assets/relay.js", import.meta.url));
const styles = fileURLToPath(new URL("./assets/relay.css", import.meta.url));

export type Relay = {
  url: string;
  /** Resolves with the edited document, once the reply has reached the page. */
  accepted: Promise<string>;
  close(): void;
};

export type Hooks = {
  /**
   * The human asked for a new task document. Their own document is about to lose
   * the screen to it, which is why the page saves before it asks.
   */
  onNew?: () => void;
  /**
   * What they have typed, sent because this document is about to leave the
   * screen — the page is destroyed when the window loads the next one, and their
   * words would go with it.
   */
  onDraft?: (text: string) => void;
};

/**
 * One process serves exactly one relay, so there are no session ids and no
 * registry — just a handful of routes over loopback.
 */
export async function serve(
  source: string,
  doc: string,
  prefill: string,
  logDir: string,
  hooks: Hooks = {},
): Promise<Relay> {
  let settle: (doc: string) => void;
  const accepted = new Promise<string>((resolve) => {
    settle = resolve;
  });

  const images = await localImages(source, doc);
  // What the editor opens with. It is what the agent sent until the human has
  // typed something and had the screen taken from them — after that it is their
  // own words, and the document they come back to is the one they left.
  let opening = prefill;
  // Lazily, and only if the human opens the pane: most relays are answered
  // without one, and a shell nobody asked for is a process nobody wanted.
  let shell: pty.Session | null = null;
  // The nvim a `gf` opened, if one is up. Its own pty rather than the shell's,
  // because the shell may well be in the middle of something the human wants
  // back afterwards; and its own lifetime, which is one file long.
  let editor: pty.Session | null = null;
  // Every command still going, so that none of them outlives the window.
  const running = new Set<Running>();
  // Numbered in the order the human ran them, so a pointer in the document leads
  // to the run that wrote it. Runs short enough to stay in the document leave a
  // gap in the numbering rather than an empty file.
  let runs = 0;

  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && path === "/") return send(res, 200, "text/html; charset=utf-8", page(source));
    // /doc is what the agent sent — the baseline every edit is measured
    // against. /prefill is what the editor opens with; the two differ only
    // under RELAY_PREFILL, which exists so the diff view can be looked at
    // without anyone having to type into it.
    if (req.method === "GET" && path === "/doc") return send(res, 200, "text/markdown; charset=utf-8", doc);
    if (req.method === "GET" && path === "/prefill") return send(res, 200, "text/markdown; charset=utf-8", opening);
    if (req.method === "GET" && path === "/assets/relay.js") {
      readFile(bundle).then(
        (js) => send(res, 200, "text/javascript; charset=utf-8", js),
        () => send(res, 500, "text/plain", "editor bundle missing — run `pnpm build`"),
      );
      return;
    }
    if (req.method === "GET" && path === "/assets/relay.css") {
      readFile(styles).then(
        (css) => send(res, 200, "text/css; charset=utf-8", css),
        () => send(res, 404, "text/plain", "not found"),
      );
      return;
    }
    // Pictures off the disk. /local is the whole allow-list, built from the
    // document before the server came up; /local/<n> is one entry of it by
    // index. The index is the point: a path never comes back off the wire, so
    // there is nothing here to traverse out of and no file to name that the
    // agent did not already name itself.
    if (req.method === "GET" && path === "/local") {
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(images.map));
    }
    if (req.method === "GET" && path.startsWith("/local/")) return sendLocal(res, images, path.slice(7));
    if (req.method === "POST" && path === "/accept") return handleAccept(req, res, settle);
    // A document losing the screen must not take the human's words with it.
    // Nothing here is a reply — the baseline is untouched, so what comes back
    // when this document returns still diffs as theirs.
    if (req.method === "POST" && path === "/draft") {
      return read(req, maxDocBytes).then(
        (text) => {
          opening = text;
          hooks.onDraft?.(text);
          res.writeHead(204).end();
        },
        () => send(res, 413, "text/plain", "document too large"),
      );
    }
    // They want to write a task. Whatever is on screen makes way for it, which
    // is why the page saves this document before asking.
    if (req.method === "POST" && path === "/new") {
      hooks.onNew?.();
      return res.writeHead(204).end();
    }
    // A shell block the human asked for. The body is the command, the response
    // is its output as it happens, and hanging up is how the human stops it.
    if (req.method === "POST" && path === "/run") {
      return handleRun(req, res, running, join(logDir, `run-${++runs}.log`));
    }
    // A link the human's cursor was on. Out to the machine from this side for the
    // same reason nvim is: the page is sandboxed, and the window it is in has no
    // handler for opening one either.
    if (req.method === "POST" && path === "/open") return handleOpen(req, res);

    // The terminal pane. Output is a stream the page listens to; input is one
    // request per burst of typing. The page is sandboxed and could not spawn a
    // shell if it tried, so the pty is on this side of the wire and these three
    // routes are the whole of the bridge.
    if (req.method === "GET" && path === "/pty") {
      const { cols, rows } = size(req);
      if (shell?.alive) shell.resize(cols, rows);
      else {
        try {
          shell = pty.open(process.cwd(), cols, rows);
        } catch (err) {
          return send(res, 503, "text/plain", `no terminal here: ${(err as Error).message}`);
        }
      }
      return stream(req, res, shell);
    }
    if (req.method === "POST" && path === "/pty/in") {
      if (!shell?.alive) return send(res, 409, "text/plain", "no shell");
      const to = shell;
      return input(req, res, (data) => to.write(data));
    }
    if (req.method === "POST" && path === "/pty/size") {
      if (!shell?.alive) return send(res, 409, "text/plain", "no shell");
      const { cols, rows } = size(req);
      shell.resize(cols, rows);
      return res.writeHead(204).end();
    }

    // The editor pane, on the same bridge and for the same reason. It is spawned
    // by a POST rather than by the stream the way the shell is, because the one
    // thing that can go wrong here — there is no such file — has something to
    // say, and an event stream that fails to open says nothing the page can read.
    if (req.method === "POST" && path === "/edit") {
      if (editor?.alive) return send(res, 409, "text/plain", "already in a file");
      return handleEdit(req, res, (session) => (editor = session));
    }
    if (req.method === "GET" && path === "/edit") {
      if (!editor?.alive) return send(res, 409, "text/plain", "nothing open");
      return stream(req, res, editor);
    }
    if (req.method === "POST" && path === "/edit/in") {
      if (!editor?.alive) return send(res, 409, "text/plain", "nothing open");
      const to = editor;
      return input(req, res, (data) => to.write(data));
    }
    if (req.method === "POST" && path === "/edit/size") {
      if (!editor?.alive) return send(res, 409, "text/plain", "nothing open");
      const { cols, rows } = size(req);
      editor.resize(cols, rows);
      return res.writeHead(204).end();
    }

    send(res, 404, "text/plain", "not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("could not bind loopback");

  return {
    url: `http://127.0.0.1:${addr.port}/`,
    accepted,
    close: () => {
      // Nothing a relay started outlives the relay. The window is going, so
      // there is nobody left to read a command's output and nowhere to put it;
      // and a shell left running would keep its stream open and the server with
      // it.
      for (const job of running) job.kill();
      running.clear();
      shell?.kill();
      // node-pty's kill is a SIGHUP, which is the signal nvim has always taken
      // as "the terminal is going" — it writes its swap file on the way out, so
      // a window accepted with an unsaved buffer in it leaves the recovery nvim
      // itself offers next time.
      editor?.kill();
      server.close();
      server.closeAllConnections();
    },
  };
}

/**
 * The shell's output, as it arrives. Server-sent events rather than a socket
 * upgrade: relay's server is a handful of routes over node's own http, and this
 * costs it no framing code — the page only ever listens here, and says what it
 * has to say by POSTing.
 *
 * Base64 because a pty speaks in carriage returns and escapes, and an event
 * stream is delimited by newlines; the bytes have to come through untouched.
 */
function stream(req: IncomingMessage, res: ServerResponse, shell: pty.Session) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });

  const event = (name: string, data: string) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${name}\ndata: ${data}\n\n`);
  };

  event("hello", JSON.stringify({ program: shell.program, cwd: shell.cwd }));
  // A reload lands on the shell that is already running, so hand it what it
  // missed before anything new arrives.
  const missed = shell.replay();
  if (missed) event("out", encode(missed));

  const off = shell.attach(
    (chunk) => event("out", encode(chunk)),
    (code) => {
      event("exit", String(code));
      res.end();
    },
  );
  req.on("close", off);
  res.on("error", off);
}

function input(req: IncomingMessage, res: ServerResponse, write: (data: string) => void) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  req.on("data", (c: Buffer) => {
    bytes += c.length;
    if (bytes > maxInputBytes) {
      send(res, 413, "text/plain", "too much at once");
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    write(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(204).end();
  });
}

/**
 * Open the human's own nvim on the path their cursor was on.
 *
 * nvim by name, not `$EDITOR`: what was asked for was their neovim, with their
 * config, their LSP and their plugins, and `$EDITOR` is as likely to be a thing
 * that opens a window of its own or takes no `+42` as it is to be that.
 *
 * The pty starts at a nominal size and the page resizes it a moment later, once
 * the pane it is going into has been laid out and measured. nvim has always
 * redrawn on a terminal resize, and this one lands well before its config has
 * finished loading, so what it draws first it draws at the right size.
 */
function handleEdit(req: IncomingMessage, res: ServerResponse, keep: (session: pty.Session) => void) {
  read(req, maxCommandBytes).then(
    (body) => {
      let want: { path?: string; line?: number; col?: number };
      try {
        want = JSON.parse(body) as typeof want;
      } catch {
        return send(res, 400, "text/plain", "not a path");
      }
      if (!want.path) return send(res, 400, "text/plain", "no path under the cursor");

      const file = locate(want.path, process.cwd());
      // Nothing opens and nothing is created — the document said a file was
      // there and it is not, which is worth being told plainly and no more.
      if (!file) return send(res, 404, "text/plain", `no ${want.path} under ${process.cwd()}`);

      const nvim = which("nvim");
      if (!nvim) return send(res, 503, "text/plain", "no nvim on this machine's PATH");

      try {
        keep(pty.run(nvim, argv(file, want.line, want.col), process.cwd(), 80, 24));
      } catch (err) {
        return send(res, 503, "text/plain", `could not open nvim: ${(err as Error).message}`);
      }
      send(res, 200, "application/json; charset=utf-8", JSON.stringify({ file }));
    },
    () => send(res, 413, "text/plain", "too long to be a path"),
  );
}

/**
 * Open the link the human's cursor was on.
 *
 * The scheme is checked here as well as in the page. Not because the page is
 * suspected of anything, but because an address arriving over the wire is not
 * the page's word for anything, and `javascript:` reaching a machine's opener is
 * the one outcome worth making impossible in both places.
 *
 * The answer waits for the opener rather than for a browser: what "it opened"
 * can honestly mean here is that the machine took it, and saying so before the
 * program has had a chance to refuse would be a footer that lies.
 */
function handleOpen(req: IncomingMessage, res: ServerResponse) {
  read(req, maxCommandBytes).then(
    (body) => {
      const url = openable(body);
      if (!url) return send(res, 400, "text/plain", "not a link relay will open");

      const program = opener();
      if (!program) return send(res, 503, "text/plain", "nothing on this machine's PATH opens a link");

      launch(program, url).then(
        () => res.writeHead(204).end(),
        (err: Error) => send(res, 502, "text/plain", `${basename(program)} refused it — ${err.message}`),
      );
    },
    () => send(res, 413, "text/plain", "too long to be a link"),
  );
}

/** How big the page says its terminal is. */
function size(req: IncomingMessage): { cols: number; rows: number } {
  const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
  const n = (name: string, fallback: number) => {
    const v = Number(params.get(name));
    return Number.isInteger(v) && v > 0 && v < 5000 ? v : fallback;
  };
  return { cols: n("cols", 80), rows: n("rows", 24) };
}

function encode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/**
 * Run a command and answer with its output as it arrives.
 *
 * Chunked text rather than a single body, because a command the human is
 * watching is worth watching as it happens. There is no run id and nothing to
 * poll: the response *is* the run, so the page aborting the request is the
 * human's ⌃C, and `close` firing before the command ended means exactly that.
 *
 * It runs in the relay's own cwd — the directory the agent asked from, which is
 * the one the command was written for.
 */
function handleRun(
  req: IncomingMessage,
  res: ServerResponse,
  running: Set<Running>,
  logPath: string,
) {
  read(req, maxCommandBytes).then(
    (command) => {
      if (!command.trim()) return send(res, 400, "text/plain", "no command");

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.flushHeaders();

      let over = false;
      const job = start(
        command,
        process.cwd(),
        (text) => {
          if (!res.writableEnded) res.write(text);
        },
        logPath,
      );
      running.add(job);

      // Both the abort and the ordinary end arrive here; only an early one is
      // the human hanging up.
      res.on("close", () => {
        if (!over) job.kill();
      });

      void job.done.then(() => {
        over = true;
        running.delete(job);
        res.end();
      });
    },
    () => send(res, 413, "text/plain", "command too large"),
  );
}

function read(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        reject(new Error("too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendLocal(res: ServerResponse, images: Images, index: string) {
  const n = /^\d+$/.test(index) ? Number(index) : -1;
  const file = images.files[n];
  if (file === undefined) return send(res, 404, "text/plain", "not found");
  readFile(file).then(
    (bytes) => send(res, 200, contentType(file), bytes),
    () => send(res, 404, "text/plain", "not found"),
  );
}

let taken = false;

function handleAccept(req: IncomingMessage, res: ServerResponse, settle: (doc: string) => void) {
  const chunks: Buffer[] = [];
  let size = 0;

  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > maxDocBytes) {
      send(res, 413, "text/plain", "document too large");
      req.destroy();
      return;
    }
    chunks.push(c);
  });

  req.on("end", () => {
    if (res.writableEnded) return;
    if (taken) return send(res, 409, "text/plain", "already accepted");
    taken = true;
    const body = Buffer.concat(chunks).toString("utf8");
    // The reply is flushed to the page *before* the waiting side is told, so
    // shutting down here can never reset the connection mid-response.
    res.writeHead(204).end(() => settle(body));
  });
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }).end(body);
}

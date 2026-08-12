import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { contentType, type Images, localImages } from "./images.js";
import { page } from "./page.js";
import * as pty from "./pty.js";

const maxDocBytes = 8 << 20;
// A keystroke, or a paste of something the human had lying around.
const maxInputBytes = 1 << 20;
const bundle = fileURLToPath(new URL("./assets/relay.js", import.meta.url));
const styles = fileURLToPath(new URL("./assets/relay.css", import.meta.url));

export type Relay = {
  url: string;
  /** Resolves with the edited document, once the reply has reached the page. */
  accepted: Promise<string>;
  close(): void;
};

/**
 * One process serves exactly one relay, so there are no session ids and no
 * registry — just a handful of routes over loopback.
 */
export async function serve(source: string, doc: string, prefill = doc): Promise<Relay> {
  let settle: (doc: string) => void;
  const accepted = new Promise<string>((resolve) => {
    settle = resolve;
  });

  const images = await localImages(source, doc);
  // Lazily, and only if the human opens the pane: most relays are answered
  // without one, and a shell nobody asked for is a process nobody wanted.
  let shell: pty.Session | null = null;

  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && path === "/") return send(res, 200, "text/html; charset=utf-8", page(source));
    // /doc is what the agent sent — the baseline every edit is measured
    // against. /prefill is what the editor opens with; the two differ only
    // under RELAY_PREFILL, which exists so the diff view can be looked at
    // without anyone having to type into it.
    if (req.method === "GET" && path === "/doc") return send(res, 200, "text/markdown; charset=utf-8", doc);
    if (req.method === "GET" && path === "/prefill") return send(res, 200, "text/markdown; charset=utf-8", prefill);
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
      // Nothing outlives the window. A shell left running would also keep the
      // stream open and the server with it.
      shell?.kill();
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

  event("hello", JSON.stringify({ shell: shell.shell, cwd: shell.cwd }));
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

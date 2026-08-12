import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { contentType, type Images, localImages } from "./images.js";
import { page } from "./page.js";
import { type Running, start } from "./run.js";

const maxDocBytes = 8 << 20;
const maxCommandBytes = 64 << 10;
const bundle = fileURLToPath(new URL("./assets/relay.js", import.meta.url));

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
export async function serve(
  source: string,
  doc: string,
  prefill: string,
  logDir: string,
): Promise<Relay> {
  let settle: (doc: string) => void;
  const accepted = new Promise<string>((resolve) => {
    settle = resolve;
  });

  const images = await localImages(source, doc);
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
    if (req.method === "GET" && path === "/prefill") return send(res, 200, "text/markdown; charset=utf-8", prefill);
    if (req.method === "GET" && path === "/assets/relay.js") {
      readFile(bundle).then(
        (js) => send(res, 200, "text/javascript; charset=utf-8", js),
        () => send(res, 500, "text/plain", "editor bundle missing — run `pnpm build`"),
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
    // A shell block the human asked for. The body is the command, the response
    // is its output as it happens, and hanging up is how the human stops it.
    if (req.method === "POST" && path === "/run") {
      return handleRun(req, res, running, join(logDir, `run-${++runs}.log`));
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
      // The window is going, so there is nobody left to read a command's output
      // and nowhere to put it. Nothing a relay started outlives the relay.
      for (const job of running) job.kill();
      running.clear();
      server.close();
    },
  };
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

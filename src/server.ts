import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { page } from "./page.js";

const maxDocBytes = 8 << 20;
const bundle = fileURLToPath(new URL("./assets/relay.js", import.meta.url));

export type Relay = {
  url: string;
  /** Resolves with the edited document, once the reply has reached the page. */
  accepted: Promise<string>;
  close(): void;
};

/**
 * One process serves exactly one relay, so there are no session ids and no
 * registry — just four routes over loopback.
 */
export async function serve(source: string, doc: string, prefill = doc): Promise<Relay> {
  let settle: (doc: string) => void;
  const accepted = new Promise<string>((resolve) => {
    settle = resolve;
  });

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
    if (req.method === "POST" && path === "/accept") return handleAccept(req, res, settle);

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
    close: () => server.close(),
  };
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

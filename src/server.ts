import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { contentType, type Images, extensionOf, keepPasted, localImages } from "./images.js";
import { launch, openable, opener } from "./open.js";
import { page } from "./page.js";
import { interactive, type Session } from "./pty.js";
import type { QueuePlan, Waiting } from "./queue-worker.js";
import { maxOutputBytes, type Running, start, tilde } from "./run.js";
import { ensureDefaultTheme } from "./theme.js";

const maxDocBytes = 8 << 20;
const maxImageBytes = 32 << 20;
const maxInputBytes = 1 << 20;
const maxCommandBytes = 64 << 10;
const bundle = fileURLToPath(new URL("./assets/relay.js", import.meta.url));
const styles = fileURLToPath(new URL("./assets/relay.css", import.meta.url));
const diagrams = fileURLToPath(new URL("./assets/mermaid.js", import.meta.url));

export type Relay = {
  url: string;
  accepted: Promise<string>;
  close(): void;
};

export type Options = {
  onDraft?: (text: string) => void;
  behind?: () => number;
  framed?: boolean;
  readOnly?: boolean;
  runnable?: boolean;
  ran?: string;
};

export async function serve(
  source: string,
  doc: string,
  prefill: string,
  logs: () => string,
  opts: Options = {},
): Promise<Relay> {
  ensureDefaultTheme();
  let settle: (doc: string) => void;
  const accepted = new Promise<string>((resolve) => {
    settle = resolve;
  });

  const images = await localImages(source, doc);
  let opening = prefill;
  const running = new Set<Running>();
  let runs = 0;
  const statuses = new Map<number, number | null>();
  const clientRuns = new Map<number, number>();
  const ttys = new Map<number, Session>();

  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && path === "/") return send(res, 200, "text/html; charset=utf-8", page(source, opts.framed, opts.readOnly));
    if (req.method === "GET" && path === "/doc") return send(res, 200, "text/markdown; charset=utf-8", doc);
    if (req.method === "GET" && path === "/prefill") return send(res, 200, "text/markdown; charset=utf-8", opening);
    if (req.method === "GET" && path === "/assets/relay.js") {
      readFile(bundle).then(
        (js) => send(res, 200, "text/javascript; charset=utf-8", js),
        () => send(res, 500, "text/plain", "editor bundle missing — run `pnpm build`"),
      );
      return;
    }
    if (req.method === "GET" && path === "/assets/mermaid.js") {
      readFile(diagrams).then(
        (js) => send(res, 200, "text/javascript; charset=utf-8", js),
        () => send(res, 500, "text/plain", "diagram bundle missing — run `pnpm build`"),
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
    if (req.method === "GET" && path === "/local") {
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(images.map));
    }
    if (req.method === "GET" && path.startsWith("/local/")) return sendLocal(res, images, path.slice(7));
    if (req.method === "POST" && path === "/paste") {
      if (opts.readOnly) return send(res, 409, "text/plain", "this round is being read, not answered");
      const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      const extension = extensionOf(type);
      if (!extension) return send(res, 415, "text/plain", `relay cannot show a pasted ${type || "file"}`);
      return readBytes(req, maxImageBytes).then(
        (bytes) =>
          keepPasted(logs(), images, bytes, extension).then(
            (kept) => send(res, 200, "application/json; charset=utf-8", JSON.stringify(kept)),
            (err) => send(res, 500, "text/plain", `could not keep the image: ${(err as Error).message}`),
          ),
        () => send(res, 413, "text/plain", "image too large"),
      );
    }
    if (req.method === "GET" && path === "/queue") {
      const waiting = opts.behind?.() ?? 0;
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ waiting }));
    }
    if (req.method === "POST" && path === "/accept") {
      if (opts.readOnly) return send(res, 409, "text/plain", "this round is being read, not answered");
      return handleAccept(req, res, settle, (waiting, finished) => {
        if (waiting.length) {
          const plan: QueuePlan = {
            cwd: process.cwd(),
            dir: logs(),
            waiting,
            finished,
            started: Object.fromEntries([...clientRuns].map(([client, id]) => [client, join(logs(), `run-${id}.log.status`)])),
          };
          writeFileSync(join(logs(), "queue-plan.json"), JSON.stringify(plan));
          writeFileSync(join(logs(), "queue-report.json"), JSON.stringify(waiting.map(({ id, command }) => ({ id, command, status: "waiting", output: null })), null, 2) + "\n");
          const worker = spawn(process.execPath, [fileURLToPath(new URL("./queue-worker.js", import.meta.url)), join(logs(), "queue-plan.json")], {
            cwd: process.cwd(),
            detached: true,
            stdio: "ignore",
          });
          worker.unref();
        }
        for (const job of running) job.detach();
        running.clear();
        for (const tty of ttys.values()) tty.stop();
      });
    }
    if (req.method === "POST" && path === "/draft") {
      if (opts.readOnly) return send(res, 409, "text/plain", "this round is being read — there is no draft to keep");
      return read(req, maxDocBytes).then(
        (text) => {
          try {
            opts.onDraft?.(text);
          } catch (err) {
            return send(res, 500, "text/plain", `could not keep the draft: ${(err as Error).message}`);
          }
          opening = text;
          res.writeHead(204).end();
        },
        () => send(res, 413, "text/plain", "document too large"),
      );
    }
    if (req.method === "GET" && path === "/run/report") {
      return send(res, 200, "text/plain; charset=utf-8", tilde(join(logs(), "queue-report.json")));
    }
    if (req.method === "GET" && path === "/run/status") {
      const id = Number(new URL(req.url!, "http://localhost").searchParams.get("id"));
      if (!statuses.has(id)) return send(res, 404, "text/plain", "run status unavailable");
      const status = statuses.get(id);
      statuses.delete(id);
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ status }));
    }
    if (req.method === "POST" && path === "/run") {
      if (opts.runnable === false) {
        const where = opts.ran ? ` — ${tilde(opts.ran)}` : "";
        return send(res, 409, "text/plain", `the worktree this round ran in is gone${where}`);
      }
      const id = ++runs;
      return handleRun(req, res, running, join(logs(), `run-${id}.log`), screenLines(req), id, statuses, clientRuns);
    }
    if (req.method === "POST" && path === "/tty") {
      if (opts.runnable === false) {
        const where = opts.ran ? ` — ${tilde(opts.ran)}` : "";
        return send(res, 409, "text/plain", `the worktree this round ran in is gone${where}`);
      }
      return read(req, maxCommandBytes).then(
        (command) => {
          if (!command.trim()) return send(res, 400, "text/plain", "no command");
          const id = ++runs;
          try {
            ttys.set(id, interactive(command, process.cwd(), columns(req)));
          } catch (err) {
            return send(res, 503, "text/plain", `relay could not run it: ${(err as Error).message}`);
          }
          send(res, 200, "application/json; charset=utf-8", JSON.stringify({ id }));
        },
        () => send(res, 413, "text/plain", "command too large"),
      );
    }
    if (path.startsWith("/tty/")) {
      const id = Number(new URL(req.url!, "http://localhost").searchParams.get("id"));
      const tty = ttys.get(id);
      if (!tty) return send(res, 404, "text/plain", "no such run");
      if (req.method === "GET" && path === "/tty/out") return stream(req, res, tty);
      if (req.method === "POST" && path === "/tty/in") return input(req, res, (data) => tty.write(data));
      if (req.method === "POST" && path === "/tty/size") {
        tty.resize(columns(req));
        return res.writeHead(204).end();
      }
      if (req.method === "POST" && path === "/tty/stop") {
        tty.stop();
        return res.writeHead(204).end();
      }
      if (req.method === "POST" && path === "/tty/keep") {
        return read(req, maxOutputBytes).then(
          (text) => {
            const log = join(logs(), `run-${id}.log`);
            try {
              writeFileSync(log, text);
            } catch (err) {
              return send(res, 500, "text/plain", `could not keep the output: ${(err as Error).message}`);
            }
            send(res, 200, "text/plain; charset=utf-8", tilde(log));
          },
          () => send(res, 413, "text/plain", "output too large"),
        );
      }
      if (req.method === "POST" && path === "/tty/done") {
        tty.stop();
        ttys.delete(id);
        return res.writeHead(204).end();
      }
    }
    if (req.method === "POST" && path === "/open") return handleOpen(req, res);

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
      for (const job of running) job.kill();
      running.clear();
      for (const tty of ttys.values()) tty.stop();
      server.close();
      server.closeAllConnections();
    },
  };
}

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

function screenLines(req: IncomingMessage): number | undefined {
  const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
  const v = Number(params.get("lines"));
  return Number.isInteger(v) && v > 0 && v < 5000 ? v : undefined;
}

function columns(req: IncomingMessage): number {
  const v = Number(new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("cols"));
  return Number.isInteger(v) && v > 0 && v < 5000 ? v : 80;
}

function stream(req: IncomingMessage, res: ServerResponse, tty: Session) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });

  const event = (name: string, data: string) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${name}\ndata: ${data}\n\n`);
  };
  const ended = (how: NonNullable<Session["ended"]>) => {
    event("exit", JSON.stringify(how));
    res.end();
  };

  const missed = tty.replay();
  if (missed) event("out", Buffer.from(missed, "utf8").toString("base64"));
  if (tty.ended) return ended(tty.ended);

  const off = tty.attach((chunk) => event("out", Buffer.from(chunk, "utf8").toString("base64")), ended);
  req.on("close", off);
  res.on("error", off);
}

function input(req: IncomingMessage, res: ServerResponse, write: (data: string) => void) {
  read(req, maxInputBytes).then(
    (data) => {
      write(data);
      res.writeHead(204).end();
    },
    () => send(res, 413, "text/plain", "too much at once"),
  );
}

function handleRun(
  req: IncomingMessage,
  res: ServerResponse,
  running: Set<Running>,
  logPath: string,
  screenLines: number | undefined,
  id: number,
  statuses: Map<number, number | null>,
  clientRuns: Map<number, number>,
) {
  read(req, maxCommandBytes).then(
    (command) => {
      if (!command.trim()) return send(res, 400, "text/plain", "no command");
      const client = Number(req.headers["x-relay-client"]);
      if (Number.isSafeInteger(client) && client > 0) clientRuns.set(client, id);

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Relay-Log": encodeURIComponent(tilde(logPath)),
        "X-Relay-Run": String(id),
      });
      res.flushHeaders();

      let over = false;
      let job: Running;
      try {
        job = start(
          command,
          process.cwd(),
          (text) => {
            if (!res.writableEnded) res.write(text);
          },
          logPath,
          screenLines,
        );
      } catch (err) {
        statuses.set(id, null);
        writeFileSync(`${logPath}.status`, "stopped");
        res.write(`relay could not run it: ${(err as Error).message}\n`);
        return res.end();
      }
      running.add(job);

      res.on("close", () => {
        if (!over) job.kill();
      });

      void job.done.then((status) => {
        over = true;
        running.delete(job);
        if (!res.destroyed) statuses.set(id, status);
        res.end();
      });
    },
    () => send(res, 413, "text/plain", "command too large"),
  );
}

function read(req: IncomingMessage, limit: number): Promise<string> {
  return readBytes(req, limit).then((bytes) => bytes.toString("utf8"));
}

function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
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
    req.on("end", () => resolve(Buffer.concat(chunks)));
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

function handleAccept(
  req: IncomingMessage,
  res: ServerResponse,
  settle: (doc: string) => void,
  letGo: (waiting: Waiting[], finished: Record<number, boolean>) => void,
) {
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
    const body = Buffer.concat(chunks).toString("utf8");
    let doc = body;
    let waiting: Waiting[] = [];
    let finished: Record<number, boolean> = {};
    if (req.headers["content-type"] === "application/vnd.relay.accept+json") {
      try {
        const payload = JSON.parse(body) as { doc: string; waiting: Waiting[]; finished: Record<number, boolean> };
        if (typeof payload.doc !== "string" || !Array.isArray(payload.waiting) || typeof payload.finished !== "object" ||
          payload.waiting.some((item) => !Number.isSafeInteger(item.id) || !Number.isSafeInteger(item.previous) ||
            typeof item.command !== "string" || item.command.length > maxCommandBytes)) throw new Error("invalid queue");
        doc = payload.doc;
        waiting = payload.waiting;
        finished = payload.finished;
      } catch {
        return send(res, 400, "text/plain", "invalid queued commands");
      }
    }
    taken = true;
    try {
      letGo(waiting, finished);
    } catch (err) {
      taken = false;
      return send(res, 500, "text/plain", `could not hand off queued commands: ${(err as Error).message}`);
    }
    res.writeHead(204).end(() => settle(doc));
  });
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }).end(body);
}

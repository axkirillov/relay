import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { argv, locate, which } from "./edit.js";
import { contentType, type Images, localImages } from "./images.js";
import { launch, openable, opener } from "./open.js";
import { page } from "./page.js";
import * as pty from "./pty.js";
import { type Running, start, tilde } from "./run.js";

const maxDocBytes = 8 << 20;
const maxInputBytes = 1 << 20;
const maxCommandBytes = 64 << 10;
const bundle = fileURLToPath(new URL("./assets/relay.js", import.meta.url));
const styles = fileURLToPath(new URL("./assets/relay.css", import.meta.url));

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
  let settle: (doc: string) => void;
  const accepted = new Promise<string>((resolve) => {
    settle = resolve;
  });

  const images = await localImages(source, doc);
  let opening = prefill;
  let shell: pty.Session | null = null;
  let editor: pty.Session | null = null;
  const running = new Set<Running>();
  let runs = 0;

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
    if (req.method === "GET" && path === "/queue") {
      const waiting = opts.behind?.() ?? 0;
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ waiting }));
    }
    if (req.method === "POST" && path === "/accept") {
      if (opts.readOnly) return send(res, 409, "text/plain", "this round is being read, not answered");
      return handleAccept(req, res, settle, () => {
        for (const job of running) job.detach();
        running.clear();
      });
    }
    if (req.method === "POST" && path === "/draft") {
      if (opts.readOnly) return send(res, 409, "text/plain", "this round is being read — there is no draft to keep");
      return read(req, maxDocBytes).then(
        (text) => {
          opening = text;
          opts.onDraft?.(text);
          res.writeHead(204).end();
        },
        () => send(res, 413, "text/plain", "document too large"),
      );
    }
    if (req.method === "POST" && path === "/run") {
      if (opts.runnable === false) {
        const where = opts.ran ? ` — ${tilde(opts.ran)}` : "";
        return send(res, 409, "text/plain", `the worktree this round ran in is gone${where}`);
      }
      return handleRun(req, res, running, join(logs(), `run-${++runs}.log`), screenLines(req));
    }
    if (req.method === "POST" && path === "/open") return handleOpen(req, res);

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
      for (const job of running) job.kill();
      running.clear();
      shell?.kill();
      editor?.kill();
      server.close();
      server.closeAllConnections();
    },
  };
}

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

function handleRun(
  req: IncomingMessage,
  res: ServerResponse,
  running: Set<Running>,
  logPath: string,
  screenLines: number | undefined,
) {
  read(req, maxCommandBytes).then(
    (command) => {
      if (!command.trim()) return send(res, 400, "text/plain", "no command");

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Relay-Log": encodeURIComponent(tilde(logPath)),
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
        res.write(`relay could not run it: ${(err as Error).message}\n`);
        return res.end();
      }
      running.add(job);

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

function handleAccept(
  req: IncomingMessage,
  res: ServerResponse,
  settle: (doc: string) => void,
  letGo: () => void,
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
    taken = true;
    letGo();
    const body = Buffer.concat(chunks).toString("utf8");
    res.writeHead(204).end(() => settle(body));
  });
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }).end(body);
}

import { stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

/** Where the window should fetch each local image from, keyed by src as written. */
export type Images = { map: Record<string, string>; files: string[] };

const scheme = /^[a-z][a-z0-9+.-]*:/i;

const types: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

/**
 * Every image source in the document that names a file rather than a URL.
 *
 * Both spellings, because a document has both: markdown images, and raw `<img>`
 * inside an HTML block. Angle brackets around a markdown path are markdown's,
 * not part of the path — and its only way to write one with a space in it. The
 * window reads a src by the same rule, so both sides arrive at the same string
 * and a lookup here can hit.
 *
 * Anything with a scheme, or protocol-relative, is a remote image — those the
 * window fetches itself and are none of this file's business.
 */
export function imageRefs(doc: string): string[] {
  const out: string[] = [];
  const md = /!\[[^\]]*\]\(\s*(?:<([^<>]*)>|([^)\s]*))/g;
  const img = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

  for (const re of [md, img]) {
    for (let m = re.exec(doc); m; m = re.exec(doc)) {
      const src = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!src || scheme.test(src) || src.startsWith("//") || src.startsWith("#")) continue;
      if (!out.includes(src)) out.push(src);
    }
  }

  return out;
}

/**
 * The files the window is allowed to ask for, and the address of each.
 *
 * The list is built here, once, from the document as the agent sent it — which
 * is the whole security design. Nothing downstream turns a request back into a
 * path: the window is handed opaque indices into `files`, so the servable set is
 * exactly the pictures the agent already put in the document and can never be
 * widened by a request, or by anything the human types afterwards.
 */
export async function localImages(source: string, doc: string): Promise<Images> {
  const dir = dirname(source);
  const map: Record<string, string> = {};
  const files: string[] = [];

  for (const ref of imageRefs(doc)) {
    const file = resolve(dir, fsPath(ref));
    if (!(await isFile(file))) continue;
    map[ref] = `/local/${files.length}`;
    files.push(file);
  }

  return { map, files };
}

export function contentType(file: string): string {
  return types[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * A src is a URL, so a path with a space in it reaches us percent-encoded —
 * that being the only way markdown can spell one. Undecodable escapes are left
 * alone; they simply will not be a file.
 */
function fsPath(ref: string): string {
  if (!ref.includes("%")) return ref;
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

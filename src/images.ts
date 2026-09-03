import { stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

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

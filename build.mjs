import { build } from "esbuild";
import { chmod, readlink, rename, symlink } from "node:fs/promises";
import { basename } from "node:path";

import { pruneBuilds } from "./src/builds.ts";

const dev = process.argv.includes("--dev");
const id = `${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${process.pid}`;
const out = `dist/builds/${id}`;

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: `${out}/relay.js`,
  external: ["electron", "node-pty"],
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as createBundleRequire } from "node:module";\nconst require = createBundleRequire(import.meta.url);' },
  minify: !dev,
  logLevel: "info",
});

await chmod(`${out}/relay.js`, 0o755);

await build({
  entryPoints: ["src/shell.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: `${out}/shell.cjs`,
  external: ["electron"],
  minify: !dev,
  logLevel: "info",
});

await build({
  entryPoints: ["src/queue-worker.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: `${out}/queue-worker.js`,
  minify: !dev,
  logLevel: "info",
});

await build({
  entryPoints: ["ui/src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: `${out}/assets/relay.js`,
  minify: !dev,
  sourcemap: dev,
  logLevel: "info",
});

await build({
  entryPoints: ["ui/src/mermaid.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: `${out}/assets/mermaid.js`,
  minify: !dev,
  logLevel: "info",
  plugins: [
    {
      name: "no-elk",
      setup(b) {
        b.onResolve({ filter: /^elkjs\/lib\/elk\.bundled\.js$/ }, () => ({ path: "elk", namespace: "no-elk" }));
        b.onLoad({ filter: /.*/, namespace: "no-elk" }, () => ({ contents: "export default class ELK {}" }));
      },
    },
  ],
});

const previous = await readlink("dist/current").catch(() => undefined);
await point("dist/current", `builds/${id}`);
await point("dist/relay.js", "current/relay.js");
await point("dist/shell.cjs", "current/shell.cjs");
pruneBuilds("dist/builds", [id, previous && basename(previous)]);

async function point(link, target) {
  const next = `${link}.${id}`;
  await symlink(target, next);
  await rename(next, link);
}

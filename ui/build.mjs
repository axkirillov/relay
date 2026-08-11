import { build } from "esbuild";
import { mkdirSync } from "node:fs";

const out = "../internal/web/dist";
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  sourcemap: false,
  outfile: `${out}/relay.js`,
  logLevel: "info",
});

import { build } from "esbuild";

const dev = process.argv.includes("--dev");

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/relay.js",
  external: ["electron"],
  banner: { js: "#!/usr/bin/env node" },
  minify: !dev,
  logLevel: "info",
});

await build({
  entryPoints: ["ui/src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: "dist/assets/relay.js",
  minify: !dev,
  sourcemap: dev,
  logLevel: "info",
});

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

// The window's own process. It reads the line to know what to show, so it is
// built from the same source as the CLI rather than kept as a hand-written
// script that has to be told the rules a second time.
await build({
  entryPoints: ["src/shell.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "dist/shell.cjs",
  external: ["electron"],
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

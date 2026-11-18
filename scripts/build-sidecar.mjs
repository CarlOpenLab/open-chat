#!/usr/bin/env node
// Bundles the sidecar (acp-hub + ACP SDK + our code) into one ESM file the
// Go binary embeds, so the shipped app needs nothing but `node` on the host.
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(root, "sidecar/src/main.ts")],
  outfile: resolve(root, "internal/sidecar/dist/sidecar.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: false,
  sourcemap: false,
  legalComments: "none",
  // cross-spawn & friends are CommonJS; give the ESM bundle a require().
  banner: {
    js: "import { createRequire as __ocRequire } from 'node:module'; const require = __ocRequire(import.meta.url);",
  },
  logLevel: "info",
});
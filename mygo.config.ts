import { defineConfig } from "mygo-cli";

export default defineConfig({
  name: "open-chat",
  slug: "open-chat",
  identifier: "com.carlopenlab.openchat",
  version: "0.0.1",
  copyright: "© 2026 CarlOpenLab",
  license: "MIT",
  icon: "resources/icon.png",

  devUrl: "http://127.0.0.1:5173",
  devCommand: "pnpm dev:web",
  buildCommand: "pnpm build:web",
  // The frontend is embedded by internal/webdist (go:embed) so that the
  // `serve` mode can reach it too; mygo.SetFrontend hands it to the window.
  bindings: "web/src/gen/mygo.ts",
  out: "build",
  linux: { maintainer: "CarlOpenLab <carlzzz0205@gmail.com>" },
});

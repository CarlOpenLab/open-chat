import { defineConfig } from "mygo-cli";
import pkg from "./package.json" with { type: "json" };

// Signed updates: the public half of the key whose secret half signs the
// release archives and manifests. `mygo keygen` writes mygo-update.key and
// mygo-update.pub; the release workflow derives this from the
// MYGO_UPDATER_PRIVATE_KEY secret, so a release needs no second value.
// Without it (development builds, `pnpm build` from a checkout) the app is
// built without an update feed and cannot update itself.
const updatePublicKey = process.env.MYGO_UPDATER_PUBLIC_KEY ?? "";

export default defineConfig({
  name: "open-chat",
  slug: "open-chat",
  identifier: "com.carlopenlab.openchat",
  version: pkg.version,
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
  ...(updatePublicKey
    ? {
        updates: {
          publicKey: updatePublicKey,
          github: "CarlOpenLab/open-chat",
        },
      }
    : {}),
});

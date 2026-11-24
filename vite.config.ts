import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve(__dirname, "internal/webdist/dist");

export default defineConfig({
  root: "web",
  base: "./",
  plugins: [
    UnoCSS(),
    vue(),
    {
      // go:embed needs the directory to exist even before the first build.
      name: "keep-dist",
      closeBundle() {
        writeFileSync(resolve(outDir, ".gitkeep"), "");
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    // `pnpm dev:web` alone (no window): proxy the API to `open-chat serve -no-auth`.
    proxy: { "/api": { target: "http://127.0.0.1:4310", changeOrigin: true } },
  },
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    target: "es2022",
  },
});

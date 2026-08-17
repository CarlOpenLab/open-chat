import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";

export default defineConfig({
  plugins: [vue(), UnoCSS()],
  resolve: {
    alias: {
      "@": "./src",
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8082",
        changeOrigin: true,
      },
    },
  },
});

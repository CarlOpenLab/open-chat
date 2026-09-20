import { defineConfig, type PluginOption } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";

export default defineConfig({
  // monorepo 下 unocss 的 Plugin 类型可能解析到另一份 vite-plus-core 实例，
  // 统一收敛到本包 vite 的 PluginOption 上（运行时插件为鸭子类型，行为不变）。
  plugins: [vue(), UnoCSS() as PluginOption],
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

import type { StorybookConfig } from "@storybook/vue3-vite";
import UnoCSS from "unocss/vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: {
    name: "@storybook/vue3-vite",
    options: {},
  },
  async viteFinal(config) {
    const { mergeConfig } = await import("vite");
    return mergeConfig(config, {
      // UnoCSS 提供 virtual:uno.css 与品牌 token 映射（vue 插件 storybook 已内置）
      plugins: [UnoCSS()],
      resolve: {
        // monorepo 下避免 Vue 双实例（antdv-next / x 组件依赖单例响应式）
        dedupe: ["vue"],
      },
    });
  },
};

export default config;

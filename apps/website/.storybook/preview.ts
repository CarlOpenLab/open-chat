import type { Preview, StoryContext } from "@storybook/vue3-vite";
import StylebookProvider from "./StylebookProvider.vue";

/** 主题工具栏：亮 / 暗切换（写入 html[data-theme]，与 App.vue 的切换方式一致）。 */
export const globalTypes = {
  theme: {
    name: "主题",
    description: "亮 / 暗主题切换",
    defaultValue: "light",
    toolbar: {
      icon: "mirror",
      items: [
        { value: "light", title: "浅色" },
        { value: "dark", title: "深色" },
      ],
      dynamicTitle: true,
    },
  },
};

export const decorators = [
  // <story /> 由 storybook 运行时注入，参数仅用于类型与潜在包装
  (_story: () => unknown, context: StoryContext) => {
    const dark = context.globals.theme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    return {
      components: { StylebookProvider },
      setup: () => ({ dark }),
      template: '<StylebookProvider :dark="dark"><story /></StylebookProvider>',
    };
  },
];

const preview: Preview = {
  parameters: {
    controls: { expanded: true },
  },
};

export default preview;

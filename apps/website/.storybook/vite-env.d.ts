/// <reference types="vite/client" />

// 与 src/vite-env.d.ts 一致：让 tsc 识别 .storybook 里对 .vue 的导入
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

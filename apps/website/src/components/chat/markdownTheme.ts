import type { ComputedRef, InjectionKey } from "vue";

export type MarkdownTheme = "light" | "dark";

export const markdownThemeKey: InjectionKey<ComputedRef<MarkdownTheme>> = Symbol("markdown-theme");

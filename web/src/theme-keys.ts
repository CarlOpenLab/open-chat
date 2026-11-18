import type { ComputedRef, InjectionKey } from "vue";

/** Whether the page is dark, for components rendered by markdown. */
export const markdownDarkKey: InjectionKey<ComputedRef<boolean>> = Symbol("markdown-dark");
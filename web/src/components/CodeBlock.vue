<script lang="ts">
import { CodeHighlighter, Mermaid } from "@antdv-next/x";
import { defineComponent, h, inject, type VNode } from "vue";
import { markdownDarkKey } from "../theme-keys";

const OPTIONS = {
  showLineNumbers: false,
  showLanguage: true,
  showCopyButton: true,
};

const textOf = (nodes: VNode[]): string =>
  nodes
    .map((node) => {
      if (typeof node.children === "string") return node.children;
      if (Array.isArray(node.children)) return textOf(node.children as VNode[]);
      return "";
    })
    .join("");

const attr = (attrs: Record<string, unknown>, name: string) => (typeof attrs[name] === "string" ? (attrs[name] as string) : "");

/** Renders a fenced code block of the answer: highlighted, with a copy button. */
export default defineComponent({
  name: "CodeBlock",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const dark = inject(markdownDarkKey);
    return () => {
      const code = textOf(slots.default?.() ?? []);
      const lang =
        attr(attrs, "data-lang") ||
        attr(attrs, "dataLang") ||
        attr(attrs, "lang") ||
        (attr(attrs, "class").match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? "");
      const isBlock = [attrs["data-block"], attrs.dataBlock, attrs.block].some((v) => v === true || v === "true");
      if (!isBlock && !lang) return h("code", code);
      if (lang === "mermaid") return h(Mermaid, { content: code, theme: dark?.value ? "dark" : "default" });
      if (code.length > 60_000) return h("pre", { class: "oc-plain-code" }, code);
      return h(CodeHighlighter, {
        content: code,
        language: lang || "text",
        theme: dark?.value ? "dark" : "light",
        ...OPTIONS,
      });
    };
  },
});
</script>

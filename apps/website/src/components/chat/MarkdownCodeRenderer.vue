<script lang="ts">
import { CodeHighlighter, Mermaid } from "@antdv-next/x";
import { defineComponent, h, inject, type VNode } from "vue";
import { markdownThemeKey } from "./markdownTheme";

const extractText = (nodes: VNode[]): string =>
  nodes
    .map((node) => {
      if (typeof node.children === "string") return node.children;
      if (Array.isArray(node.children)) return extractText(node.children as VNode[]);
      return "";
    })
    .join("");

const readStringAttr = (attrs: Record<string, unknown>, name: string) =>
  typeof attrs[name] === "string" ? attrs[name] : "";

export default defineComponent({
  name: "MarkdownCodeRenderer",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const theme = inject(markdownThemeKey);

    return () => {
      const code = extractText(slots.default?.() ?? []);
      const className = readStringAttr(attrs, "class");
      const classLang = className.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? "";
      const language =
        readStringAttr(attrs, "data-lang") ||
        readStringAttr(attrs, "dataLang") ||
        readStringAttr(attrs, "lang") ||
        classLang;
      const isBlock = [attrs["data-block"], attrs.dataBlock, attrs.block].some(
        (value) => value === true || value === "true",
      );

      if (!isBlock && !language) return h("code", code);
      if (language === "mermaid") return h(Mermaid, { content: code });

      return h(CodeHighlighter, {
        content: code,
        language: language || "text",
        theme: theme?.value ?? "light",
        showLineNumbers: true,
        showLanguage: true,
        showCopyButton: true,
      });
    };
  },
});
</script>

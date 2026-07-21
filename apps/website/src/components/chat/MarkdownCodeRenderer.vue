<script setup lang="ts">
import { CodeHighlighter, Mermaid } from "@antdv-next/x";
import { computed, useAttrs, useSlots, type VNode } from "vue";

defineOptions({
  name: "MarkdownCodeRenderer",
  inheritAttrs: false,
});

const attrs = useAttrs();
const slots = useSlots();

const extractText = (nodes: VNode[]): string =>
  nodes
    .map((node) => {
      if (typeof node.children === "string") return node.children;
      if (Array.isArray(node.children)) return extractText(node.children as VNode[]);
      return "";
    })
    .join("");

const code = computed(() => extractText(slots.default?.() ?? []));

const language = computed(() => {
  const dataLang = typeof attrs["data-lang"] === "string" ? attrs["data-lang"] : "";
  const dataLangCamel = typeof attrs.dataLang === "string" ? attrs.dataLang : "";
  const lang = typeof attrs.lang === "string" ? attrs.lang : "";
  const className = typeof attrs.class === "string" ? attrs.class : "";
  const classLang = className.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? "";
  return dataLang || dataLangCamel || lang || classLang;
});

const isBlock = computed(() => {
  const values = [attrs["data-block"], attrs.dataBlock, attrs.block];
  return values.some((value) => value === true || value === "true");
});
</script>

<template>
  <code v-if="!isBlock && !language">{{ code }}</code>
  <Mermaid v-else-if="language === 'mermaid'" :content="code" />
  <CodeHighlighter
    v-else
    :content="code"
    :language="language || 'text'"
    :show-line-numbers="true"
    :show-language="true"
    :show-copy-button="true"
  />
</template>

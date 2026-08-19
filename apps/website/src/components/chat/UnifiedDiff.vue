<script setup lang="ts">
import { computed } from "vue";
import { CodeHighlighter } from "@antdv-next/x";

interface Props {
  /** 该文件的 raw unified diff（裸 hunk 或完整 patch 均可）。 */
  patch: string;
  /** 文件路径（用于补文件头）。 */
  path: string;
  theme?: "light" | "dark";
}

const props = withDefaults(defineProps<Props>(), { theme: "light" });

/** 规整：补上 ---/+++ 文件头，统一换行，供 CodeHighlighter / shiki diff 高亮。 */
const normalized = computed(() => {
  const t = props.patch.replace(/\r\n/g, "\n").trimEnd();
  if (/^(diff --git|---\s)/m.test(t)) return t;
  return `--- ${props.path}\n+++ ${props.path}\n${t}`;
});
</script>

<template>
  <CodeHighlighter
    :content="normalized"
    language="diff"
    :theme="theme"
    :show-line-numbers="false"
    :show-language="true"
    :show-copy-button="true"
    class="unified-diff-code"
  />
</template>

<style>
.unified-diff-code {
  --ant-font-size: 12px;
  /* 让 CodeHighlighter 自适应容器宽度，覆盖内部圆角与边框由外层决定时可调整 */
  :deep(.antd-code-highlighter) {
    border: 0;
    border-radius: 6px;
  }
  :deep(.antd-code-highlighter pre) {
    font-size: 11.5px;
    line-height: 1.55;
  }
}
</style>

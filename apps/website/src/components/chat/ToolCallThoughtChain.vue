<script setup lang="ts">
import type { ThoughtChainItemType } from "@antdv-next/x";
import { ThoughtChain } from "@antdv-next/x";
import { computed } from "vue";
import type { ToolCallItem } from "../../services/OpenChatProvider";

interface Props {
  tools?: ToolCallItem[];
}

const props = withDefaults(defineProps<Props>(), { tools: () => [] });

const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
};

const formatToolDetail = (value: unknown, maxLength = 4000): string => {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "object" && value !== null) {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value ?? "");
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…（内容过长已截断）` : text;
};

const items = computed<ThoughtChainItemType[]>(() =>
  props.tools.map((tool) => {
    const status: ThoughtChainItemType["status"] =
      tool.status === "completed" ? "success" : tool.status === "error" ? "error" : "loading";
    const statusText =
      tool.status === "completed"
        ? tool.durationMs != null && formatDuration(tool.durationMs)
          ? `完成 · ${formatDuration(tool.durationMs)}`
          : "完成"
        : tool.status === "error"
          ? "失败"
          : tool.status === "running"
            ? "执行中"
            : "准备中";
    const lines: string[] = [];
    if (tool.input !== undefined) {
      const inputText = formatToolDetail(tool.input, 2000);
      if (inputText) lines.push(`输入：${inputText}`);
    }
    if (tool.output) lines.push(`输出：${formatToolDetail(tool.output)}`);
    if (tool.error) lines.push(`错误：${tool.error}`);
    return {
      key: tool.id || `tool-${tool.name}`,
      title: tool.name || "工具调用",
      description: statusText,
      status,
      collapsible: lines.length > 0,
      blink: tool.status === "running",
      content: lines.join("\n\n"),
    };
  }),
);
</script>

<template>
  <ThoughtChain v-if="items.length" class="tool-call-thought-chain" :items="items" line="solid" />
</template>

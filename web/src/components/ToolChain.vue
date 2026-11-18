<script setup lang="ts">
import { ThoughtChain } from "@antdv-next/x";
import type { ThoughtChainItemType } from "@antdv-next/x";
import {
  BulbOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LoadingOutlined,
  SearchOutlined,
  CodeOutlined,
  ToolOutlined,
  BranchesOutlined,
} from "@antdv-next/icons";
import { computed, h } from "vue";
import type { ToolCall } from "../types";
import DiffView from "./DiffView.vue";

/** The agent's tool activity of one turn, as a compact chain. */
const props = defineProps<{ calls: ToolCall[]; live: boolean }>();

const KIND_ICON: Record<string, () => unknown> = {
  read: () => h(FileTextOutlined),
  edit: () => h(EditOutlined),
  delete: () => h(DeleteOutlined),
  move: () => h(BranchesOutlined),
  search: () => h(SearchOutlined),
  execute: () => h(CodeOutlined),
  think: () => h(BulbOutlined),
  fetch: () => h(GlobalOutlined),
  switch_mode: () => h(BranchesOutlined),
};

const fileName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

function statusOf(call: ToolCall): "loading" | "success" | "error" {
  if (call.status === "failed") return "error";
  if (call.status === "completed") return "success";
  return "loading";
}

function details(call: ToolCall) {
  const parts: unknown[] = [];
  const text: string[] = [];
  for (const c of call.content ?? []) {
    if (c.type === "diff") {
      parts.push(h(DiffView, { oldText: c.oldText, newText: c.newText, path: c.path }));
    } else if (c.type === "content" && c.content.type === "text" && c.content.text) {
      text.push(c.content.text);
    }
  }
  if (text.length) parts.push(h("pre", { class: "out mono selectable" }, text.join("\n").slice(0, 6000)));
  if (!parts.length && call.rawInput != null) {
    parts.push(h("pre", { class: "out mono selectable" }, JSON.stringify(call.rawInput, null, 2).slice(0, 3000)));
  }
  return parts.length ? h("div", { class: "tool-detail" }, parts as never) : null;
}

const items = computed<ThoughtChainItemType[]>(() =>
  props.calls.map((call, i) => {
    const last = i === props.calls.length - 1;
    const icon = call.status === "failed"
      ? h(CloseCircleOutlined)
      : call.status === "completed"
        ? h(CheckCircleOutlined)
        : h(LoadingOutlined, { spin: true });
    const desc: string[] = [];
    const first = call.locations?.[0]?.path;
    if (first) desc.push(fileName(first));
    if (call.kind === "execute" && call.rawInput) {
      const cmd = (call.rawInput as { command?: unknown }).command;
      if (typeof cmd === "string") desc.push(cmd);
    }
    const pending = call.status === "pending" || call.status === "in_progress";
    return {
      key: call.toolCallId,
      icon,
      title: h("span", { class: "tool-title" }, call.title ?? call.kind ?? "工具调用"),
      description: desc.length ? h("span", { class: "tool-desc mono" }, desc.join(" · ")) : undefined,
      status: statusOf(call),
      blink: pending && last && props.live,
      content: details(call) ?? undefined,
      collapsible: Boolean(details(call)),
      destroyOnHidden: false,
      // The running call stays open; finished ones fold away.
    } satisfies ThoughtChainItemType;
  }),
);

const anyOpen = computed(() => props.calls.some((c) => c.status === "pending" || c.status === "in_progress"));
const expanded = computed(() => props.calls.filter((c) => c.status !== "completed").map((c) => c.toolCallId));
</script>

<template>
  <ThoughtChain
    v-if="items.length"
    :items="items"
    :expanded-keys="anyOpen ? expanded : []"
    line="dashed"
    class="chain"
  />
</template>

<style scoped>
.chain {
  margin: 2px 0 10px;
  font-size: 13px;
}
.chain :deep(.antd-thought-chain-node-title) {
  font-size: 13px;
  color: var(--text);
}
.tool-title {
  font-weight: 450;
}
.tool-desc {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
  max-width: 380px;
  vertical-align: bottom;
}
:deep(.tool-detail) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 0 6px;
}
:deep(.out) {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.55;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>

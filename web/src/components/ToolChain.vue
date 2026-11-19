<script setup lang="ts">
import {
  BranchesOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LoadingOutlined,
  SearchOutlined,
  ToolOutlined,
} from "@antdv-next/icons";
import { h, ref, watch } from "vue";
import type { ToolCall } from "../types";
import DiffView from "./DiffView.vue";

/** The agent's tool activity of one turn, as a sleek left-aligned collapsible timeline. */
const props = defineProps<{ calls: ToolCall[]; live: boolean }>();

const KIND_META: Record<string, { label: string; icon: () => unknown }> = {
  read: { label: "读取", icon: () => h(FileTextOutlined) },
  edit: { label: "编辑", icon: () => h(EditOutlined) },
  delete: { label: "删除", icon: () => h(DeleteOutlined) },
  move: { label: "移动", icon: () => h(BranchesOutlined) },
  search: { label: "搜索", icon: () => h(SearchOutlined) },
  execute: { label: "执行", icon: () => h(CodeOutlined) },
  think: { label: "分析", icon: () => h(BulbOutlined) },
  fetch: { label: "抓取", icon: () => h(GlobalOutlined) },
  switch_mode: { label: "切换模式", icon: () => h(BranchesOutlined) },
};

const fileName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

function commandOf(call: ToolCall): string {
  if (call.kind !== "execute" || !call.rawInput) return "";
  const raw = call.rawInput as { command?: unknown; cmd?: unknown };
  if (typeof raw.command === "string") return raw.command.trim();
  if (typeof raw.cmd === "string") return raw.cmd.trim();
  return "";
}

function titleOf(call: ToolCall): string {
  const t = (call.title ?? "").trim();
  if (t) return t;
  const cmd = commandOf(call);
  if (cmd) return cmd;
  return call.kind ? (KIND_META[call.kind]?.label ?? call.kind) : "工具调用";
}

function fileBadgeOf(call: ToolCall): string {
  const first = call.locations?.[0]?.path;
  if (!first) return "";
  const name = fileName(first);
  return titleOf(call).includes(name) ? "" : name;
}

function diffsOf(call: ToolCall) {
  return (call.content ?? []).filter(
    (c): c is Extract<NonNullable<ToolCall["content"]>[number], { type: "diff" }> => c.type === "diff",
  );
}

function textOutputOf(call: ToolCall): string {
  const text: string[] = [];
  for (const c of call.content ?? []) {
    if (c.type === "content" && c.content.type === "text" && c.content.text) {
      text.push(c.content.text);
    }
  }
  return text.join("\n").trim().slice(0, 6000);
}

function rawInputJsonOf(call: ToolCall): string {
  if (call.rawInput == null) return "";
  if (diffsOf(call).length > 0 || textOutputOf(call).length > 0) return "";
  if (call.kind === "execute" && commandOf(call)) return "";
  try {
    return JSON.stringify(call.rawInput, null, 2).slice(0, 3000);
  } catch {
    return "";
  }
}

function hasDetail(call: ToolCall): boolean {
  return Boolean(
    diffsOf(call).length > 0 ||
      textOutputOf(call).length > 0 ||
      rawInputJsonOf(call).length > 0 ||
      (call.kind === "execute" && (commandOf(call) || titleOf(call).length > 60)),
  );
}

const expandedKeys = ref<Set<string>>(new Set());
const prevStatuses = new Map<string, ToolCall["status"]>();

watch(
  () => props.calls.map((c) => `${c.toolCallId}:${c.status}`),
  () => {
    const next = new Set(expandedKeys.value);
    for (const c of props.calls) {
      const prev = prevStatuses.get(c.toolCallId);
      const isRunning = c.status === "pending" || c.status === "in_progress";
      const wasRunning = prev === "pending" || prev === "in_progress";
      if (isRunning && !prev) {
        next.add(c.toolCallId);
      } else if (wasRunning && c.status === "completed") {
        next.delete(c.toolCallId);
      } else if (c.status === "failed" && prev !== "failed") {
        next.add(c.toolCallId);
      }
      prevStatuses.set(c.toolCallId, c.status);
    }
    expandedKeys.value = next;
  },
  { immediate: true },
);

function toggle(id: string) {
  const next = new Set(expandedKeys.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedKeys.value = next;
}
</script>

<template>
  <div v-if="calls.length" class="chain">
    <div
      v-for="(call, idx) in calls"
      :key="call.toolCallId"
      class="tool-row"
      :class="{
        expanded: expandedKeys.has(call.toolCallId),
        running: call.status === 'pending' || call.status === 'in_progress',
        failed: call.status === 'failed',
        last: idx === calls.length - 1,
      }"
    >
      <!-- Left rail: status dot/icon + dashed connector -->
      <div class="tool-rail">
        <span class="tool-status-ic" :class="call.status">
          <CloseCircleOutlined v-if="call.status === 'failed'" />
          <CheckCircleOutlined v-else-if="call.status === 'completed'" />
          <LoadingOutlined v-else spin />
        </span>
        <span v-if="idx < calls.length - 1" class="tool-line" />
      </div>

      <!-- Right content: left-aligned header + smooth CSS Grid collapse drawer -->
      <div class="tool-main">
        <button
          type="button"
          class="tool-head"
          :class="{ clickable: hasDetail(call) }"
          :disabled="!hasDetail(call)"
          :aria-expanded="expandedKeys.has(call.toolCallId)"
          @click="hasDetail(call) && toggle(call.toolCallId)"
        >
          <span class="tool-kind">
            <component :is="call.kind && KIND_META[call.kind] ? KIND_META[call.kind].icon : () => h(ToolOutlined)" />
            <span>{{ (call.kind && KIND_META[call.kind]?.label) || "工具" }}</span>
          </span>

          <span
            class="tool-title"
            :class="{
              mono: call.kind === 'execute',
              'shimmer-text': live && (call.status === 'pending' || call.status === 'in_progress'),
            }"
            :title="titleOf(call)"
          >
            {{ titleOf(call) }}
          </span>

          <span v-if="fileBadgeOf(call)" class="tool-file mono" :title="call.locations?.[0]?.path">
            {{ fileBadgeOf(call) }}
          </span>

          <svg
            v-if="hasDetail(call)"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="tool-chev"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <div v-if="hasDetail(call)" class="tool-collapse" :class="{ open: expandedKeys.has(call.toolCallId) }">
          <div class="tool-collapse-inner">
            <div class="tool-detail">
              <div v-if="call.kind === 'execute' && (commandOf(call) || titleOf(call))" class="cmd-box mono selectable">
                <span class="cmd-prompt">$</span>
                <span class="cmd-text">{{ commandOf(call) || titleOf(call) }}</span>
              </div>

              <DiffView
                v-for="(d, di) in diffsOf(call)"
                :key="di"
                :old-text="d.oldText"
                :new-text="d.newText"
                :path="d.path"
              />

              <pre v-if="textOutputOf(call)" class="out mono selectable">{{ textOutputOf(call) }}</pre>
              <pre v-else-if="rawInputJsonOf(call)" class="out mono selectable">{{ rawInputJsonOf(call) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chain {
  display: flex;
  flex-direction: column;
  margin: 4px 0 12px;
}

.tool-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.tool-rail {
  width: 18px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 7px;
}

.tool-status-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 13.5px;
  line-height: 1;
  color: var(--text-3);
  flex: none;
}
.tool-status-ic.completed {
  color: var(--ok);
}
.tool-status-ic.failed {
  color: var(--err);
}
.tool-status-ic.pending,
.tool-status-ic.in_progress {
  color: var(--text-2);
}

.tool-line {
  flex: 1;
  width: 0;
  min-height: 10px;
  margin: 4px 0 2px;
  border-left: 1px dashed var(--border-strong);
}

.tool-main {
  flex: 1;
  min-width: 0;
  padding-bottom: 4px;
}
.tool-row.last .tool-main {
  padding-bottom: 0;
}

.tool-head {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 3px 4px;
  margin-left: -4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  cursor: default;
  transition: color 0.14s var(--ease);
}
.tool-head.clickable {
  cursor: pointer;
}
.tool-head.clickable:hover .tool-title,
.tool-row.expanded .tool-head.clickable .tool-title {
  color: var(--text);
}
.tool-head.clickable:hover .tool-kind,
.tool-row.expanded .tool-head.clickable .tool-kind {
  color: var(--text);
  border-color: var(--border-strong);
}
.tool-head.clickable:hover .tool-chev,
.tool-row.expanded .tool-head.clickable .tool-chev {
  color: var(--text);
}

.tool-kind {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  background: var(--hover);
  border: 1px solid var(--border);
  color: var(--text-2);
  font-size: 11px;
  line-height: 1;
  flex: none;
  transition: color 0.14s var(--ease), border-color 0.14s var(--ease);
}

.tool-title {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 480;
  color: var(--text-2);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.14s var(--ease);
}
.tool-title.mono {
  font-size: 12px;
  color: var(--text-2);
}

.tool-file {
  flex: none;
  max-width: 150px;
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-chev {
  width: 13px;
  height: 13px;
  color: var(--text-3);
  flex: none;
  margin-left: auto;
  transition: transform 0.22s var(--ease), color 0.14s;
}
.tool-row.expanded .tool-chev {
  transform: rotate(90deg);
  color: var(--text-2);
}

/* Smooth CSS Grid collapse transition */
.tool-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 0.24s var(--ease), opacity 0.2s ease;
}
.tool-collapse.open {
  grid-template-rows: 1fr;
  opacity: 1;
}
.tool-collapse-inner {
  overflow: hidden;
  min-height: 0;
}

.tool-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 0 4px 2px;
}

.cmd-box {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--text);
  word-break: break-all;
}
.cmd-prompt {
  color: var(--text-3);
  user-select: none;
  flex: none;
}
.cmd-text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
}

.out {
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

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
import { message } from "antdv-next";
import { h, nextTick, ref } from "vue";
import { api, inApp } from "../api";
import { activeMeta, openWorkspaceFile } from "../store";
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

function openLocation(path?: string) {
  if (!path) return;
  const cwd = activeMeta.value?.cwd ?? "";
  if (openWorkspaceFile(path, cwd)) return;
  if (inApp) {
    void api.openLink(path, cwd).catch((err) => message.error(err instanceof Error ? err.message : String(err)));
  }
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

function hasTextOutput(call: ToolCall): boolean {
  for (const c of call.content ?? []) {
    if (c.type === "content" && c.content.type === "text" && c.content.text && c.content.text.trim()) {
      return true;
    }
  }
  return false;
}

function hasDiff(call: ToolCall): boolean {
  for (const c of call.content ?? []) {
    if (c.type === "diff") return true;
  }
  return false;
}

function rawInputJsonOf(call: ToolCall): string {
  if (call.rawInput == null) return "";
  if (hasDiff(call) || hasTextOutput(call)) return "";
  if (call.kind === "execute" && commandOf(call)) return "";
  try {
    return JSON.stringify(call.rawInput, null, 2).slice(0, 3000);
  } catch {
    return "";
  }
}

function hasDetail(call: ToolCall): boolean {
  if (hasDiff(call) || hasTextOutput(call)) return true;
  if (call.kind === "execute" && (commandOf(call) || titleOf(call).length > 60)) return true;
  if (call.rawInput != null) {
    if (typeof call.rawInput === "object") {
      return Object.keys(call.rawInput as Record<string, unknown>).length > 0;
    }
    return true;
  }
  return false;
}

// Collapsed by default; detail DOM (DiffView / pre) is only mounted when first expanded.
const expandedKeys = ref<Set<string>>(new Set());
const mountedKeys = ref<Set<string>>(new Set());
const pendingExpand = new Set<string>();

function toggle(id: string) {
  if (expandedKeys.value.has(id) || pendingExpand.has(id)) {
    pendingExpand.delete(id);
    const next = new Set(expandedKeys.value);
    next.delete(id);
    expandedKeys.value = next;
    return;
  }
  if (!mountedKeys.value.has(id)) {
    const nextMounted = new Set(mountedKeys.value);
    nextMounted.add(id);
    mountedKeys.value = nextMounted;
    pendingExpand.add(id);
    // Mount in 0fr state first, then trigger .open on the next paint frame so CSS transition runs.
    void nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!pendingExpand.delete(id)) return;
          const next = new Set(expandedKeys.value);
          next.add(id);
          expandedKeys.value = next;
        });
      });
    });
    return;
  }
  const next = new Set(expandedKeys.value);
  next.add(id);
  expandedKeys.value = next;
}
</script>

<template>
  <div v-if="calls.length" class="flex flex-col mt-1 mb-3">
    <div
      v-for="(call, idx) in calls"
      :key="call.toolCallId"
      class="flex items-stretch gap-2 min-w-0"
    >
      <!-- Left rail: status dot/icon + dashed connector -->
      <div class="w-[18px] flex-none flex flex-col items-center pt-1">
        <span
          class="inline-flex items-center justify-center w-4 h-4 text-[13.5px] leading-none flex-none"
          :class="
            call.status === 'completed'
              ? 'text-ok'
              : call.status === 'failed' || !live
                ? 'text-err'
                : call.status === 'pending' || call.status === 'in_progress'
                  ? 'text-ink-2'
                  : 'text-ink-3'
          "
        >
          <CheckCircleOutlined v-if="call.status === 'completed'" />
          <CloseCircleOutlined v-else-if="call.status === 'failed' || !live" />
          <LoadingOutlined v-else spin />
        </span>
        <span
          v-if="idx < calls.length - 1"
          class="flex-1 w-0 min-h-1 mt-[2px] -mb-[2px] border-0 border-l border-dashed border-line-strong"
        />
      </div>

      <!-- Right content: left-aligned header + smooth CSS Grid collapse drawer -->
      <div class="flex-1 min-w-0" :class="idx === calls.length - 1 ? 'pb-0' : 'pb-[2px]'">
        <button
          type="button"
          class="group/tool flex items-center justify-start gap-2 w-full min-h-6 px-1 py-[2px] -ml-1 border-0 rounded-[6px] bg-transparent text-ink-2 text-left transition-colors duration-140 ease-oc"
          :class="hasDetail(call) ? 'cursor-pointer' : 'cursor-default'"
          :disabled="!hasDetail(call)"
          :aria-expanded="expandedKeys.has(call.toolCallId)"
          @click="hasDetail(call) && toggle(call.toolCallId)"
        >
          <span
            class="inline-flex items-center gap-1 h-5 px-[7px] rounded-[6px] bg-hover border border-solid text-[11px] leading-none flex-none transition-colors duration-140 ease-oc"
            :class="
              expandedKeys.has(call.toolCallId) && hasDetail(call)
                ? 'text-ink border-line-strong'
                : hasDetail(call)
                  ? 'text-ink-2 border-line group-hover/tool:text-ink group-hover/tool:border-line-strong'
                  : 'text-ink-2 border-line'
            "
          >
            <component :is="call.kind && KIND_META[call.kind] ? KIND_META[call.kind].icon : () => h(ToolOutlined)" />
            <span>{{ (call.kind && KIND_META[call.kind]?.label) || "工具" }}</span>
          </span>

          <span
            class="flex-1 min-w-0 fw-480 text-left truncate transition-colors duration-140 ease-oc"
            :class="[
              call.kind === 'execute' ? 'font-mono text-[12px]' : 'text-[12.5px]',
              live && (call.status === 'pending' || call.status === 'in_progress') ? 'shimmer-text' : '',
              expandedKeys.has(call.toolCallId) && hasDetail(call)
                ? 'text-ink'
                : hasDetail(call)
                  ? 'text-ink-2 group-hover/tool:text-ink'
                  : 'text-ink-2',
            ]"
            :title="titleOf(call)"
          >
            {{ titleOf(call) }}
          </span>

          <span
            v-if="fileBadgeOf(call)"
            role="button"
            tabindex="0"
            class="flex-none max-w-[150px] text-[11px] text-ink-3 truncate px-[5px] py-[1px] rounded-[5px] cursor-pointer font-mono transition-colors duration-140 ease-oc hover:text-ink hover:bg-hover hover:underline hover:underline-offset-2"
            :title="`在文件树中打开：${call.locations?.[0]?.path}`"
            @click.stop="openLocation(call.locations?.[0]?.path)"
            @keydown.enter.stop.prevent="openLocation(call.locations?.[0]?.path)"
          >
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
            class="w-[13px] h-[13px] flex-none ml-auto transition-[transform,color] duration-220 ease-oc"
            :class="
              expandedKeys.has(call.toolCallId)
                ? 'rotate-90 text-ink'
                : 'text-ink-3 group-hover/tool:text-ink'
            "
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <div
          v-if="mountedKeys.has(call.toolCallId)"
          class="collapse-grid"
          :class="{ 'collapse-grid-open': expandedKeys.has(call.toolCallId) }"
        >
          <div class="overflow-hidden min-h-0">
            <div class="flex flex-col gap-[6px] pt-[6px] pb-1 pl-[2px]">
              <div
                v-if="call.kind === 'execute' && (commandOf(call) || titleOf(call))"
                class="flex items-start gap-[7px] px-[10px] py-[7px] rounded-[8px] bg-surface-2 border border-solid border-line text-[11.5px] leading-[1.55] text-ink break-all font-mono selectable"
              >
                <span class="text-ink-3 select-none flex-none">$</span>
                <span class="flex-1 min-w-0 whitespace-pre-wrap">{{ commandOf(call) || titleOf(call) }}</span>
              </div>

              <DiffView
                v-for="(d, di) in diffsOf(call)"
                :key="di"
                :old-text="d.oldText"
                :new-text="d.newText"
                :path="d.path"
              />

              <pre
                v-if="textOutputOf(call)"
                class="m-0 max-h-[260px] overflow-auto text-[11.5px] leading-[1.55] bg-code-bg border border-solid border-line rounded-[8px] px-[10px] py-2 text-ink-2 whitespace-pre-wrap break-words font-mono selectable"
              >{{ textOutputOf(call) }}</pre>
              <pre
                v-else-if="rawInputJsonOf(call)"
                class="m-0 max-h-[260px] overflow-auto text-[11.5px] leading-[1.55] bg-code-bg border border-solid border-line rounded-[8px] px-[10px] py-2 text-ink-2 whitespace-pre-wrap break-words font-mono selectable"
              >{{ rawInputJsonOf(call) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

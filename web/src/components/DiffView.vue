<script setup lang="ts">
import { message } from "antdv-next";
import { computed, ref } from "vue";
import { api, inApp } from "../api";
import { activeMeta, openWorkspaceFile } from "../store";

const props = defineProps<{ oldText?: string | null; newText: string; path?: string }>();

const LIMIT = 16;
const open = ref(false);

interface Row {
  kind: "ctx" | "add" | "del";
  text: string;
  no: number | null;
}

/** A line diff: a plain two-pointer walk, which is enough for tool call patches. */
const rows = computed<Row[]>(() => {
  const a = (props.oldText ?? "").split("\n");
  const b = props.newText.split("\n");
  if (!props.oldText) return b.map((text, i) => ({ kind: "add" as const, text, no: i + 1 }));
  // Trim the common head and tail, then show the middle as removed + added.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const out: Row[] = [];
  for (let i = 0; i < head; i++) out.push({ kind: "ctx", text: a[i], no: i + 1 });
  for (let i = head; i < a.length - tail; i++) out.push({ kind: "del", text: a[i], no: i + 1 });
  for (let i = head; i < b.length - tail; i++) out.push({ kind: "add", text: b[i], no: i + 1 });
  for (let i = b.length - tail; i < b.length; i++) out.push({ kind: "ctx", text: b[i], no: i + 1 });
  return out;
});

const stats = computed(() => ({
  add: rows.value.filter((r) => r.kind === "add").length,
  del: rows.value.filter((r) => r.kind === "del").length,
}));

const shown = computed(() => (open.value ? rows.value : rows.value.slice(0, LIMIT)));
const hidden = computed(() => rows.value.length - shown.value.length);

const name = computed(() => (props.path ?? "").split("/").filter(Boolean).pop() ?? props.path ?? "");

function openFile() {
  if (!props.path) return;
  const cwd = activeMeta.value?.cwd ?? "";
  if (openWorkspaceFile(props.path, cwd)) return;
  if (inApp) {
    void api.openLink(props.path, cwd).catch((err) => message.error(err instanceof Error ? err.message : String(err)));
  }
}
</script>

<template>
  <div class="border border-solid border-line rounded-[9px] overflow-hidden bg-code-bg text-[12px]">
    <div class="flex items-center gap-2 px-[10px] py-[6px] border-0 border-b border-solid border-line bg-surface-2 text-[11.5px]">
      <button
        v-if="props.path"
        type="button"
        class="text-ink-2 truncate border-0 bg-transparent px-1 py-[1px] -ml-1 rounded-[5px] text-inherit cursor-pointer text-left font-mono transition-colors duration-140 ease-oc hover:text-ink hover:bg-hover hover:underline hover:underline-offset-2"
        :title="`在文件树中打开：${props.path}`"
        @click="openFile"
      >
        {{ name }}
      </button>
      <span v-else class="text-ink-2 truncate font-mono">{{ name }}</span>
      <span class="ml-auto font-mono text-[11px]">
        <span class="text-diff-add-text">+{{ stats.add }}</span>
        {{ " " }}
        <span class="text-diff-del-text">−{{ stats.del }}</span>
      </span>
    </div>
    <div class="max-h-[320px] overflow-auto py-1 leading-[1.55] font-mono selectable">
      <div
        v-for="(row, i) in shown"
        :key="i"
        class="flex gap-[6px] pl-[6px] pr-[10px] whitespace-pre-wrap break-words"
        :class="
          row.kind === 'add'
            ? 'bg-diff-add text-diff-add-text'
            : row.kind === 'del'
              ? 'bg-diff-del text-diff-del-text'
              : 'text-ink-2'
        "
      >
        <span class="flex-none w-[10px] text-center opacity-65 select-none">
          {{ row.kind === "add" ? "+" : row.kind === "del" ? "−" : " " }}
        </span>
        <span class="flex-1">{{ row.text || " " }}</span>
      </div>
      <button
        v-if="hidden > 0"
        class="mx-[10px] mt-1 mb-[6px] border-0 bg-transparent text-accent-text text-[11.5px] cursor-pointer py-[2px] px-0"
        @click="open = true"
      >
        展开其余 {{ hidden }} 行
      </button>
    </div>
  </div>
</template>
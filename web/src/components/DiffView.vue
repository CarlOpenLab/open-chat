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
  <div class="diff">
    <div class="diff-head">
      <button
        v-if="props.path"
        type="button"
        class="file file-link mono"
        :title="`在文件树中打开：${props.path}`"
        @click="openFile"
      >
        {{ name }}
      </button>
      <span v-else class="file mono">{{ name }}</span>
      <span class="stat"><span class="add">+{{ stats.add }}</span> <span class="del">−{{ stats.del }}</span></span>
    </div>
    <div class="diff-body mono selectable">
      <div v-for="(row, i) in shown" :key="i" class="line" :class="row.kind">
        <span class="sign">{{ row.kind === "add" ? "+" : row.kind === "del" ? "−" : " " }}</span>
        <span class="text">{{ row.text || " " }}</span>
      </div>
      <button v-if="hidden > 0" class="more" @click="open = true">展开其余 {{ hidden }} 行</button>
    </div>
  </div>
</template>

<style scoped>
.diff {
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
  background: var(--code-bg);
  font-size: 12px;
}
.diff-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 11.5px;
}
.file {
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-link {
  border: none;
  background: transparent;
  padding: 1px 4px;
  margin-left: -4px;
  border-radius: 5px;
  font-size: inherit;
  cursor: pointer;
  text-align: left;
  transition: color 0.14s var(--ease), background 0.14s var(--ease);
}
.file-link:hover {
  color: var(--text);
  background: var(--hover);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.stat {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 11px;
}
.stat .add {
  color: var(--diff-add-text);
}
.stat .del {
  color: var(--diff-del-text);
}
.diff-body {
  max-height: 320px;
  overflow: auto;
  padding: 4px 0;
  line-height: 1.55;
}
.line {
  display: flex;
  gap: 6px;
  padding: 0 10px 0 6px;
  white-space: pre-wrap;
  word-break: break-word;
}
.line.add {
  background: var(--diff-add);
  color: var(--diff-add-text);
}
.line.del {
  background: var(--diff-del);
  color: var(--diff-del-text);
}
.line.ctx {
  color: var(--text-2);
}
.sign {
  flex: none;
  width: 10px;
  text-align: center;
  opacity: 0.65;
  user-select: none;
}
.text {
  flex: 1;
}
.more {
  margin: 4px 10px 6px;
  border: none;
  background: transparent;
  color: var(--accent-text);
  font-size: 11.5px;
  cursor: pointer;
  padding: 2px 0;
}
</style>
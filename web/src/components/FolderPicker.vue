<script setup lang="ts">
import { FolderOutlined, HomeOutlined, RightOutlined, UpOutlined, CheckOutlined, HistoryOutlined } from "@antdv-next/icons";
import { Button, Input, Modal, Spin } from "antdv-next";
import { computed, ref, watch } from "vue";
import { api, inApp } from "../api";
import { store } from "../store";
import type { DirListing } from "../types";

const props = defineProps<{ open: boolean; path?: string }>();
const emit = defineEmits<{ "update:open": [boolean]; pick: [path: string] }>();

const current = ref<DirListing | null>(null);
const typed = ref("");
const loading = ref(false);
const error = ref("");

async function go(path: string) {
  loading.value = true;
  error.value = "";
  try {
    current.value = await api.listDir(path);
    typed.value = current.value.path;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void go(props.path || store.settings?.recentDirs?.[0] || "~");
  },
);

const shortcuts = computed(() => {
  const list: { label: string; path: string; icon: "home" | "recent" }[] = [];
  if (store.boot?.home) list.push({ label: "主目录", path: store.boot.home, icon: "home" });
  for (const d of store.settings?.recentDirs ?? []) {
    if (d !== store.boot?.home) list.push({ label: d.split("/").filter(Boolean).pop() || d, path: d, icon: "recent" });
  }
  return list.slice(0, 6);
});

async function pickNative() {
  const path = await api.pickFolder();
  if (path) choose(path);
}

function choose(path: string) {
  emit("pick", path);
  emit("update:open", false);
}

const parent = computed(() => current.value?.parent ?? "");
</script>

<template>
  <Modal
    :open="props.open"
    :width="560"
    title="选择工作目录"
    :footer="null"
    @cancel="emit('update:open', false)"
  >
    <p class="tip">agent 会在这个目录里读写文件、跑命令。</p>

    <div class="path-row">
      <Input
        v-model:value="typed"
        class="mono"
        size="middle"
        placeholder="/path/to/project"
        @press-enter="go(typed)"
      >
        <template #prefix><FolderOutlined class="faint" /></template>
      </Input>
      <Button @click="go(typed)">前往</Button>
      <Button v-if="inApp" @click="pickNative">浏览…</Button>
    </div>

    <div v-if="shortcuts.length" class="quick">
      <button v-for="s in shortcuts" :key="s.path" class="quick-item" :title="s.path" @click="go(s.path)">
        <HomeOutlined v-if="s.icon === 'home'" />
        <HistoryOutlined v-else />
        <span>{{ s.label }}</span>
      </button>
    </div>

    <div class="list">
      <button v-if="parent" class="row up" @click="go(parent)">
        <UpOutlined />
        <span class="mono">..</span>
      </button>
      <Spin v-if="loading" size="small" class="spin" />
      <template v-else>
        <button v-for="d in current?.dirs ?? []" :key="d" class="row" @click="go(`${current?.path}/${d}`)">
          <FolderOutlined class="dir-icon" />
          <span class="name">{{ d }}</span>
          <RightOutlined class="chev" />
        </button>
        <div v-if="!(current?.dirs ?? []).length" class="empty faint">这个目录里没有子目录</div>
      </template>
    </div>

    <div v-if="error" class="err">{{ error }}</div>

    <div class="foot">
      <span v-if="current?.isRepo" class="repo-badge">git 仓库</span>
      <span class="spacer" />
      <Button @click="emit('update:open', false)">取消</Button>
      <Button type="primary" :disabled="!current" @click="choose(current!.path)">
        <template #icon><CheckOutlined /></template>
        用这个目录
      </Button>
    </div>
  </Modal>
</template>

<style scoped>
.tip {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--text-3);
}
.path-row {
  display: flex;
  gap: 6px;
}
.path-row :deep(.ant-input-affix-wrapper) {
  font-family: var(--mono);
  font-size: 12.5px;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 4px;
}
.quick-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-2);
  font-size: 11.5px;
  cursor: pointer;
  max-width: 180px;
}
.quick-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-item:hover {
  background: var(--hover);
  color: var(--text);
}
.list {
  margin-top: 8px;
  height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px;
  position: relative;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 7px;
  padding: 6px 8px;
  text-align: left;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
}
.row:hover {
  background: var(--hover);
}
.dir-icon {
  color: var(--text-3);
  font-size: 13px;
}
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chev {
  font-size: 9px;
  color: var(--text-3);
  opacity: 0;
}
.row:hover .chev {
  opacity: 1;
}
.up {
  color: var(--text-3);
}
.empty {
  padding: 20px;
  text-align: center;
  font-size: 12.5px;
}
.spin {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.err {
  margin-top: 8px;
  font-size: 12px;
  color: var(--err);
}
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}
.spacer {
  flex: 1;
}
.repo-badge {
  font-size: 11px;
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 12%, transparent);
  border-radius: 5px;
  padding: 1px 6px;
}
</style>
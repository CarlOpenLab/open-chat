<script setup lang="ts">
import { CheckOutlined, FolderOutlined, HistoryOutlined, HomeOutlined, RightOutlined, SearchOutlined, UpOutlined } from "@antdv-next/icons";
import { Button, Input, Modal, Spin } from "antdv-next";
import { computed, ref, watch } from "vue";
import { api, inApp } from "../api";
import { store } from "../store";
import type { DirListing } from "../types";

const props = defineProps<{ open: boolean; path?: string }>();
const emit = defineEmits<{ "update:open": [boolean]; pick: [path: string] }>();

const current = ref<DirListing | null>(null);
const typed = ref("");
const filter = ref("");
const loading = ref(false);
const error = ref("");

async function go(path: string) {
  loading.value = true;
  error.value = "";
  filter.value = "";
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

const breadcrumbs = computed<{ label: string; path: string }[]>(() => {
  const p = current.value?.path;
  if (!p) return [];
  const home = store.boot?.home;
  if (home && (p === home || p.startsWith(home + "/"))) {
    const rel = p.slice(home.length).split("/").filter(Boolean);
    const items = [{ label: "~", path: home }];
    let acc = home;
    for (const seg of rel) {
      acc = `${acc}/${seg}`;
      items.push({ label: seg, path: acc });
    }
    return items;
  }
  const segs = p.split("/").filter(Boolean);
  const items = [{ label: "/", path: "/" }];
  let acc = "";
  for (const seg of segs) {
    acc = `${acc}/${seg}`;
    items.push({ label: seg, path: acc });
  }
  return items;
});

const visibleDirs = computed(() => {
  const dirs = current.value?.dirs ?? [];
  const q = filter.value.trim().toLowerCase();
  return q ? dirs.filter((d) => d.toLowerCase().includes(q)) : dirs;
});

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
    centered
    title="选择工作目录"
    @cancel="emit('update:open', false)"
  >
    <p class="m-0 mb-3 text-[12.5px] text-ink-3">Agent 将在这个目录里读写文件与执行命令，也可以不指定目录直接对话。</p>

    <div class="oc-folder-path-row flex gap-[6px]">
      <Input
        v-model:value="typed"
        class="font-mono"
        size="middle"
        placeholder="/path/to/project"
        @press-enter="go(typed)"
      >
        <template #prefix><FolderOutlined class="text-ink-3" /></template>
      </Input>
      <Button @click="go(typed)">前往</Button>
      <Button v-if="inApp" @click="pickNative">浏览…</Button>
    </div>

    <div v-if="shortcuts.length" class="flex flex-wrap gap-[6px] mt-[10px] mb-1">
      <button
        v-for="s in shortcuts"
        :key="s.path"
        class="inline-flex items-center gap-[5px] h-6 px-2 rounded-[7px] border border-solid border-line bg-transparent text-ink-2 text-[11.5px] cursor-pointer max-w-[180px] transition-colors duration-130 hover:bg-hover hover:border-line-strong hover:text-ink"
        :title="s.path"
        @click="go(s.path)"
      >
        <HomeOutlined v-if="s.icon === 'home'" />
        <HistoryOutlined v-else />
        <span class="truncate">{{ s.label }}</span>
      </button>
    </div>

    <div v-if="breadcrumbs.length" class="flex items-center flex-wrap gap-[2px] mt-2 px-[6px] py-1 rounded-[8px] bg-hover min-h-7">
      <template v-for="(c, i) in breadcrumbs" :key="c.path">
        <span v-if="i > 0" class="text-ink-3 opacity-50 text-[11px]">/</span>
        <button
          class="border-0 bg-transparent text-[11.5px] px-[5px] py-[1px] rounded-[5px] cursor-pointer font-mono transition-colors duration-120 hover:bg-active hover:text-ink"
          :class="i === breadcrumbs.length - 1 ? 'text-ink fw-560' : 'text-ink-3'"
          @click="go(c.path)"
        >
          {{ c.label }}
        </button>
      </template>
      <span
        v-if="current?.isRepo"
        class="ml-1 text-[10.5px] text-ink-3 bg-surface-strong border border-solid border-line rounded-[5px] px-[6px] leading-[18px] font-mono flex-none"
      >
        git
      </span>
      <Input
        v-if="(current?.dirs ?? []).length > 8"
        v-model:value="filter"
        size="small"
        variant="borderless"
        allow-clear
        placeholder="筛选子目录…"
        class="ml-auto w-[136px]"
      >
        <template #prefix><SearchOutlined class="text-ink-3" /></template>
      </Input>
    </div>

    <div class="mt-2 h-[248px] overflow-y-auto border border-solid border-line rounded-[10px] p-1 relative">
      <button
        v-if="parent"
        class="flex items-center gap-2 w-full border-0 bg-transparent rounded-[7px] px-2 py-[6px] text-left text-[13px] text-ink-3 cursor-pointer transition-colors duration-120 hover:bg-hover"
        @click="go(parent)"
      >
        <UpOutlined />
        <span class="font-mono">..</span>
      </button>
      <Spin v-if="loading" size="small" class="absolute inset-0 grid place-items-center" />
      <template v-else>
        <button
          v-for="d in visibleDirs"
          :key="d"
          class="group flex items-center gap-2 w-full border-0 bg-transparent rounded-[7px] px-2 py-[6px] text-left text-[13px] text-ink cursor-pointer transition-colors duration-120 hover:bg-hover"
          @click="go(`${current?.path}/${d}`)"
        >
          <FolderOutlined class="text-ink-3 text-[13px]" />
          <span class="flex-1 truncate">{{ d }}</span>
          <RightOutlined class="text-[9px] text-ink-3 opacity-0 transition-opacity duration-120 group-hover:opacity-100" />
        </button>
        <div v-if="!visibleDirs.length" class="p-5 text-center text-[12.5px] text-ink-3">
          {{ filter ? "没有匹配的子目录" : "这个目录里没有子目录" }}
        </div>
      </template>
    </div>

    <div v-if="error" class="mt-2 text-[12px] text-err">{{ error }}</div>

    <template #footer>
      <div class="flex items-center gap-2">
        <Button @click="choose('')">不使用工作目录</Button>
        <span class="flex-1" />
        <Button @click="emit('update:open', false)">取消</Button>
        <Button type="primary" :disabled="!current" @click="choose(current!.path)">
          <template #icon><CheckOutlined /></template>
          用这个目录
        </Button>
      </div>
    </template>
  </Modal>
</template>

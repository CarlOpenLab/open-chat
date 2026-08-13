<script setup lang="ts">
import {
  CloudDownload,
  CloudUpload,
  Database,
  Info,
  Monitor,
  Moon,
  Settings2,
  Sun,
  Trash2,
} from "@lucide/vue";
import { Drawer, Segmented, Select, Upload, Button, type SelectProps } from "antdv-next";
import { computed, ref, watch } from "vue";

type ThemeMode = "system" | "light" | "dark";

interface Props {
  open: boolean;
  dark: boolean;
  themeMode: ThemeMode;
  currentModel: string;
  modelOptions: SelectProps["options"];
}

interface Emits {
  (e: "update:open", value: boolean): void;
  (e: "themeModeChange", mode: ThemeMode): void;
  (e: "modelChange", key: string): void;
  (e: "exportHistory"): void;
  (e: "importHistory", file: File): void;
  (e: "clearHistory"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const activeTab = ref<"general" | "model" | "data" | "about">("general");

const themeModeValue = computed({
  get: () => props.themeMode,
  set: (mode: ThemeMode) => emit("themeModeChange", mode),
});

const modelValue = computed({
  get: () => props.currentModel,
  set: (value: string) => emit("modelChange", value),
});

watch(
  () => props.open,
  (open) => {
    if (open) activeTab.value = "general";
  },
);

const navItems = [
  { key: "general", label: "常规", icon: Settings2 },
  { key: "model", label: "模型", icon: CloudDownload },
  { key: "data", label: "数据", icon: Database },
  { key: "about", label: "关于", icon: Info },
] as const;
</script>

<template>
  <Drawer
    :open="open"
    :width="520"
    :closable="true"
    placement="right"
    title="设置"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex gap-6">
      <nav class="w-[132px] flex-none" aria-label="设置分类">
        <button
          v-for="item in navItems"
          :key="item.key"
          type="button"
          class="flex h-8 w-full items-center gap-2 border-0 rounded-[6px] bg-transparent px-2 text-left text-[12.5px] text-brand-muted"
          :class="
            activeTab === item.key
              ? 'bg-brand-surface-subtle font-semibold text-brand-foreground'
              : 'hover:bg-brand-surface-subtle hover:text-brand-foreground'
          "
          :aria-current="activeTab === item.key ? 'page' : undefined"
          @click="activeTab = item.key"
        >
          <component :is="item.icon" class="!h-[14px] !w-[14px]" />
          {{ item.label }}
        </button>
      </nav>

      <div class="min-w-0 flex-1">
        <section v-if="activeTab === 'general'" aria-label="常规设置">
          <h2 class="mb-4 text-[13px] font-semibold text-brand-foreground">外观</h2>
          <div class="mb-1 text-[11px] text-brand-muted">主题</div>
          <Segmented
            :value="themeModeValue"
            :options="[
              { label: '跟随系统', value: 'system', icon: Monitor },
              { label: '浅色', value: 'light', icon: Sun },
              { label: '深色', value: 'dark', icon: Moon },
            ]"
            @change="themeModeValue = $event as ThemeMode"
          />
          <p class="mt-2 mb-0 text-[11px] leading-[16px] text-brand-muted-strong">
            跟随系统时会随操作系统的明暗设置自动切换。
          </p>
        </section>

        <section v-else-if="activeTab === 'model'" aria-label="模型设置">
          <h2 class="mb-4 text-[13px] font-semibold text-brand-foreground">默认模型</h2>
          <div class="mb-1 text-[11px] text-brand-muted">每次新建任务使用的模型</div>
          <Select
            v-model:value="modelValue"
            :options="modelOptions"
            class="w-full"
            placeholder="选择模型"
          />
        </section>

        <section v-else-if="activeTab === 'data'" aria-label="数据设置">
          <h2 class="mb-4 text-[13px] font-semibold text-brand-foreground">聊天记录</h2>
          <p class="mb-4 text-[11.5px] leading-[17px] text-brand-muted">
            记录保存在浏览器本地（IndexedDB），不会上传到服务器。
          </p>
          <div class="flex flex-col gap-2">
            <Button block @click="emit('exportHistory')">
              <CloudDownload class="!h-[14px] !w-[14px]" />导出记录
            </Button>
            <Upload
              :show-upload-list="false"
              accept=".json"
              :before-upload="
                (file: File) => {
                  emit('importHistory', file);
                  return false;
                }
              "
            >
              <Button block> <CloudUpload class="!h-[14px] !w-[14px]" />导入记录 </Button>
            </Upload>
            <Button block danger @click="emit('clearHistory')">
              <Trash2 class="!h-[14px] !w-[14px]" />清空历史
            </Button>
          </div>
        </section>

        <section v-else aria-label="关于">
          <h2 class="mb-4 text-[13px] font-semibold text-brand-foreground">Open Chat</h2>
          <p class="text-[11.5px] leading-[17px] text-brand-muted">
            基于 <code>@antdv-next/x</code> 与 <code>antdv-next</code> 构建的 AI 对话工作区，
            布局与交互复刻 Waku。
          </p>
          <p class="text-[11px] text-brand-muted-strong">v0.0.0</p>
        </section>
      </div>
    </div>
  </Drawer>
</template>

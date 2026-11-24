<script setup lang="ts">
import { MenuUnfoldOutlined } from "@antdv-next/icons";
import { Tooltip, message } from "antdv-next";
import { computed, onMounted, ref, watch } from "vue";
import { isMac, refreshAgents, start, store } from "../store";
import type { Block } from "../types";
import Composer from "./Composer.vue";
import FolderPicker from "./FolderPicker.vue";
import WindowControls from "./WindowControls.vue";

const selected = ref<string>("");
const chosenModel = ref<{ configId: string; value: string } | null>(null);
const cwd = ref<string>("");
const draft = ref("");
const folderOpen = ref(false);
const busy = ref(false);

watch(selected, (id) => {
  const cached = store.cachedModels[id];
  chosenModel.value = cached?.currentValue != null ? { configId: cached.id, value: String(cached.currentValue) } : null;
});

onMounted(() => {
  void refreshAgents();
  const preferred = store.settings?.defaultAgent ?? "";
  const available = store.agents.filter((a) => a.available && !a.disabled);
  selected.value = available.find((a) => a.id === preferred)?.id ?? available[0]?.id ?? store.agents[0]?.id ?? "";
  cwd.value = store.settings?.recentDirs?.[0] || store.boot?.home || "";
});

const agents = computed(() => store.agents.filter((a) => !a.disabled));
const current = computed(() => agents.value.find((a) => a.id === selected.value));
const projectTitle = computed(() => {
  const home = store.boot?.home;
  if (!cwd.value || (home && cwd.value === home)) return "开始一个新任务";
  return cwd.value.split("/").filter(Boolean).pop() || "开始一个新任务";
});

async function send(blocks: Block[]) {
  if (!current.value) {
    message.warning("先在输入框右下角选择一个 ACP 供应商");
    return;
  }
  if (!current.value.available) {
    message.warning(`${current.value.name} 还没安装或没在 PATH 里`);
    return;
  }
  busy.value = true;
  try {
    await start(current.value.id, cwd.value, blocks, chosenModel.value);
    draft.value = "";
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

const emptyLive = {
  status: "idle" as const,
  agentInfo: null,
  capabilities: { loadSession: false, image: false, audio: false, embeddedContext: false },
  modes: null,
  configOptions: [] as never[],
  commands: [] as never[],
  resumed: false,
};

const pickDir = (p: string) => {
  cwd.value = p;
  folderOpen.value = false;
};

const noAgent = computed(() => agents.value.length === 0);
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <header class="h-titlebar flex-none flex items-center gap-1 px-3">
      <Tooltip v-if="store.sidebarCollapsed" :title="`展开侧栏 (${isMac ? '⌘' : 'Ctrl'} B)`" :mouse-enter-delay="0.4">
        <button
          class="icon-btn no-drag"
          :class="{ 'ml-[72px]': isMac && store.sidebarCollapsed }"
          @click="store.sidebarCollapsed = false"
        >
          <MenuUnfoldOutlined />
        </button>
      </Tooltip>
      <div class="drag flex-1 h-full" />
      <WindowControls />
    </header>

    <div class="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-7 pb-24 gap-[18px] animate-oc-rise [&>*]:w-full [&>*]:max-w-[680px]">
      <div class="flex justify-center text-center mb-1">
        <h1 class="m-0 text-[24px] font-semibold tracking-[-0.025em] text-ink leading-[1.3]">{{ projectTitle }}</h1>
      </div>

      <Composer
        v-model:value="draft"
        v-model:agent-id="selected"
        v-model:cwd="cwd"
        :live="emptyLive"
        :agent-name="current?.name ?? '选择供应商'"
        :selected-model-value="chosenModel?.value"
        :recent-dirs="store.settings?.recentDirs ?? []"
        :sending="busy"
        :disabled="!current?.available"
        :placeholder="current?.available ? `交给 ${current.name} 处理什么？` : '请在右下角选择一个已安装的 ACP 供应商…'"
        @send="send"
        @manage="store.settingsOpen = true"
        @pick-model="(cid, val) => (chosenModel = { configId: cid, value: val })"
        @pick-mode=""
        @cwd="folderOpen = true"
        @stop=""
      />

      <div
        v-if="noAgent || (current && !current.available)"
        class="text-[12px] text-ink-2 bg-surface-2 glass-sm border border-solid border-line rounded-[10px] px-3 py-[9px] leading-[1.65]"
      >
        <template v-if="noAgent">
          <b>还没有可用的 ACP 供应商。</b>在设置里添加自定义 ACP agent，或安装 Claude Code / Codex 后重试。
        </template>
        <template v-else>
          <b>{{ current?.name }} 未找到命令 <code class="font-mono bg-hover px-[5px] py-[1px] rounded-[4px]">{{ current?.probe }}</code>。</b>
          装好后点此重新检测，或在右下角切换其他供应商。
          <button
            class="border-0 bg-transparent text-ink cursor-pointer text-inherit px-[2px] underline underline-offset-2"
            @click="refreshAgents"
          >
            重新检测
          </button>
        </template>
      </div>

      <p
        v-if="store.boot?.nodeError"
        class="m-0 text-[12px] text-err bg-err-soft glass-sm border border-solid border-[color-mix(in_srgb,var(--err)_25%,transparent)] rounded-[10px] px-3 py-[9px] leading-[1.65]"
      >
        <b>Node.js 不可用：</b>{{ store.boot.nodeError }}
      </p>
    </div>

    <FolderPicker v-model:open="folderOpen" :path="cwd" @pick="pickDir" />
  </div>
</template>

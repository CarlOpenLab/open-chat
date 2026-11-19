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
  <div class="new">
    <header class="bar">
      <Tooltip v-if="store.sidebarCollapsed" :title="`展开侧栏 (${isMac ? '⌘' : 'Ctrl'} B)`" :mouse-enter-delay="0.4">
        <button class="icon-btn no-drag" :class="{ mac: isMac && store.sidebarCollapsed }" @click="store.sidebarCollapsed = false">
          <MenuUnfoldOutlined />
        </button>
      </Tooltip>
      <div class="drag" style="flex: 1; height: 100%" />
      <WindowControls />
    </header>

    <div class="body rise">
      <div class="hero">
        <h1 class="heading">{{ projectTitle }}</h1>
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

      <div v-if="noAgent || (current && !current.available)" class="setup">
        <template v-if="noAgent">
          <b>还没有可用的 ACP 供应商。</b>在设置里添加自定义 ACP agent，或安装 Claude Code / Codex 后重试。
        </template>
        <template v-else>
          <b>{{ current?.name }} 未找到命令 <code class="mono">{{ current?.probe }}</code>。</b>
          装好后点此重新检测，或在右下角切换其他供应商。
          <button class="link" @click="refreshAgents">重新检测</button>
        </template>
      </div>

      <p v-if="store.boot?.nodeError" class="setup err">
        <b>Node.js 不可用：</b>{{ store.boot.nodeError }}
      </p>
    </div>

    <FolderPicker v-model:open="folderOpen" :path="cwd" @pick="pickDir" />
  </div>
</template>

<style scoped>
.new {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  height: var(--titlebar);
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
}
.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--hover);
  color: var(--text);
}
.mac {
  margin-left: 74px;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 28px 96px;
  gap: 18px;
}
.body > * {
  width: 100%;
  max-width: 680px;
}

.hero {
  display: flex;
  justify-content: center;
  text-align: center;
  margin-bottom: 4px;
}
.heading {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.025em;
  color: var(--text);
  line-height: 1.3;
}

.setup {
  font-size: 12px;
  color: var(--text-2);
  background: var(--surface-2);
  backdrop-filter: var(--glass-blur-sm);
  -webkit-backdrop-filter: var(--glass-blur-sm);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 12px;
  line-height: 1.65;
}
.setup.err {
  color: var(--err);
  background: var(--err-soft);
  border-color: color-mix(in srgb, var(--err) 25%, transparent);
}
.setup code {
  background: var(--hover);
  padding: 1px 5px;
  border-radius: 4px;
}
.link {
  border: none;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: inherit;
  padding: 0 2px;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>

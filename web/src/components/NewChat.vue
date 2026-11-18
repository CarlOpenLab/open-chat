<script setup lang="ts">
import { Prompts, Welcome } from "@antdv-next/x";
import {
  ArrowRightOutlined,
  CheckOutlined,
  CodeOutlined,
  DownOutlined,
  FolderOpenOutlined,
  MenuUnfoldOutlined,
  RocketOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@antdv-next/icons";
import { Tooltip, message } from "antdv-next";
import { computed, h, onMounted, ref } from "vue";
import { inApp } from "../api";
import { isMac, start, store, refreshAgents, saveSettings } from "../store";
import type { Block } from "../types";
import Composer from "./Composer.vue";
import FolderPicker from "./FolderPicker.vue";
import WindowControls from "./WindowControls.vue";

const selected = ref<string>("");
const cwd = ref<string>("");
const draft = ref("");
const folderOpen = ref(false);
const busy = ref(false);

onMounted(() => {
  void refreshAgents();
  const preferred = store.settings?.defaultAgent ?? "";
  const available = store.agents.filter((a) => a.available && !a.disabled);
  selected.value = available.find((a) => a.id === preferred)?.id ?? available[0]?.id ?? store.agents[0]?.id ?? "";
  cwd.value = store.settings?.recentDirs?.[0] || store.boot?.home || "";
});

const agents = computed(() => store.agents.filter((a) => !a.disabled));
const current = computed(() => agents.value.find((a) => a.id === selected.value));

const agentColors = ["#6b6bf0", "#e0823f", "#3f9ae0", "#3fbf8f", "#b05fe0", "#e05f8f"];
const colorOf = (id: string) => agentColors[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % agentColors.length];
const initials = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase();

const suggestions = [
  { key: "explain", icon: () => h(CodeOutlined), label: "读懂这个项目", description: "梳理目录结构、入口和关键模块", text: "先看一下这个项目的结构，告诉我它是做什么的、入口在哪、主要模块怎么分工。" },
  { key: "review", icon: () => h(CheckOutlined), label: "审一遍改动", description: "看当前未提交的改动，指出问题", text: "review 一下当前工作区未提交的改动，重点看有没有 bug、边界情况和风格不一致。" },
  { key: "bug", icon: () => h(WarningOutlined), label: "查一个 bug", description: "复现、定位、给出最小修复", text: "帮我查一个 bug：先复现，再定位根因，最后给最小改动的修复。" },
  { key: "test", icon: () => h(RocketOutlined), label: "补测试", description: "给最近改动的函数加回归测试", text: "给最近改动最多的那个模块补一组回归测试，先看现有测试怎么写。" },
];

function pickSuggestion(text: string) {
  draft.value = text;
}

async function send(blocks: Block[]) {
  if (!current.value) {
    message.warning("先选一个 agent");
    return;
  }
  if (!current.value.available) {
    message.warning(`${current.value.name} 还没安装或没在 PATH 里`);
    return;
  }
  busy.value = true;
  try {
    await start(current.value.id, cwd.value, blocks);
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

/** A path as the UI shows it: `~` for the home directory. */
const nice = (p: string) => {
  const home = store.boot?.home;
  if (home && p === home) return "~";
  if (home && p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
};

const noAgent = computed(() => agents.value.length === 0);
const noneAvailable = computed(() => !noAgent.value && agents.value.every((a) => !a.available));
</script>

<template>
  <div class="new">
    <header class="bar">
      <div class="drag" style="flex: 1; height: 100%" />
      <Tooltip v-if="store.sidebarCollapsed" title="展开侧栏" :mouse-enter-delay="0.4">
        <button class="icon-btn no-drag" :class="{ mac: isMac && store.sidebarCollapsed }" @click="store.sidebarCollapsed = false">
          <MenuUnfoldOutlined />
        </button>
      </Tooltip>
      <WindowControls />
    </header>

    <div class="body">
      <div class="hero">
        <Welcome
          class="welcome"
          :icon="h(ThunderboltOutlined)"
          title="今天想做什么？"
          :description="`选一个 agent，给它一个目录，然后说你想做什么。`"
          variant="borderless"
        />
      </div>

      <div class="picker">
        <div class="agents">
          <button
            v-for="a in agents"
            :key="a.id"
            class="agent-card"
            :class="{ active: a.id === selected, off: !a.available }"
            :title="a.available ? a.description : `没找到命令：${a.probe}`"
            @click="selected = a.id"
          >
            <span class="badge" :style="{ background: colorOf(a.id) }">{{ initials(a.name) }}</span>
            <span class="meta">
              <span class="name">{{ a.name }}</span>
              <span class="state">
                <template v-if="a.available">{{ a.demo ? "内置演示" : "已安装" }}</template>
                <template v-else>未安装</template>
              </span>
            </span>
            <CheckOutlined v-if="a.id === selected" class="tick" />
          </button>
        </div>
      </div>

      <div class="cwd-row">
        <button class="cwd-pill" @click="folderOpen = true">
          <FolderOpenOutlined />
          <span class="path mono">{{ cwd ? nice(cwd) : "选择工作目录" }}</span>
          <DownOutlined class="chev" />
        </button>
        <span v-if="store.settings?.recentDirs?.length" class="recent">
          <button
            v-for="d in (store.settings.recentDirs ?? []).slice(0, 3)"
            :key="d"
            class="recent-item mono"
            :title="d"
            @click="cwd = d"
          >
            {{ nice(d).split("/").filter(Boolean).pop() ?? "~" }}
          </button>
        </span>
      </div>

      <Composer
        v-model:value="draft"
        compact
        :live="emptyLive"
        :agent-name="current?.name ?? '选择 agent'"
        :cwd="cwd"
        :sending="busy"
        :disabled="!current?.available"
        placeholder="描述你的任务，越具体越好…"
        @send="send"
        @agent=""
        @pick-model=""
        @pick-mode=""
        @cwd="folderOpen = true"
        @stop=""
      />

      <div class="prompts">
        <Prompts
          :items="suggestions.map((s) => ({ key: s.key, icon: s.icon(), label: s.label, description: s.description }))"
          vertical
          :fade-in="false"
          @item-click="(info: { data: { key: string } }) => pickSuggestion(suggestions.find((s) => s.key === info.data.key)?.text ?? '')"
        />
      </div>

      <div v-if="noAgent || (current && !current.available)" class="setup">
        <template v-if="noAgent">
          <b>还没有可用的 agent。</b>在设置里添加一个自定义 ACP agent，或安装 Claude Code / Codex 后重开。
        </template>
        <template v-else>
          <b>{{ current?.name }} 没找到命令 <code class="mono">{{ current?.probe }}</code>。</b>
          在终端装好并登录后，点这里重新检测。
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
  padding: 0 28px 60px;
  gap: 16px;
}
.body > * {
  width: 100%;
  max-width: 660px;
}

.hero {
  display: flex;
  justify-content: center;
  margin-bottom: 2px;
}
.welcome :deep(.antd-welcome-title) {
  font-size: 22px !important;
  font-weight: 650 !important;
  letter-spacing: -0.02em;
}
.welcome :deep(.antd-welcome-description) {
  font-size: 13px !important;
  color: var(--text-3) !important;
}
.welcome :deep(.antd-welcome-icon) {
  color: var(--accent);
}

.agents {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
.agent-card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 6px;
  border-radius: 11px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.16s var(--ease), box-shadow 0.16s var(--ease), transform 0.16s var(--ease);
}
.agent-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
}
.agent-card.active {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.agent-card.off {
  opacity: 0.55;
}
.badge {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.25;
}
.name {
  font-size: 12.5px;
  font-weight: 550;
  color: var(--text);
}
.state {
  font-size: 10.5px;
  color: var(--text-3);
}
.tick {
  font-size: 10px;
  color: var(--accent);
  margin-left: 2px;
}

.cwd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.cwd-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 420px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.cwd-pill:hover {
  background: var(--hover);
  color: var(--text);
}
.path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
}
.chev {
  font-size: 9px;
  color: var(--text-3);
}
.recent {
  display: inline-flex;
  gap: 5px;
}
.recent-item {
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: none;
  background: var(--hover);
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
}
.recent-item:hover {
  color: var(--text);
}

.prompts {
  margin-top: 2px;
}
.prompts :deep(.antd-prompts-item) {
  border-radius: 10px !important;
  border: 1px solid var(--border) !important;
  background: var(--surface) !important;
  padding: 9px 12px !important;
  transition: border-color 0.15s, transform 0.15s var(--ease);
}
.prompts :deep(.antd-prompts-item:hover) {
  border-color: var(--border-strong) !important;
  transform: translateY(-1px);
}
.prompts :deep(.antd-prompts-label) {
  font-size: 12.8px !important;
  font-weight: 500 !important;
}
.prompts :deep(.antd-prompts-desc) {
  font-size: 11.5px !important;
  color: var(--text-3) !important;
}

.setup {
  font-size: 12.5px;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 9px;
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
  color: var(--accent-text);
  cursor: pointer;
  font-size: inherit;
  padding: 0 2px;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>

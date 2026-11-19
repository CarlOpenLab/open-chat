<script setup lang="ts">
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@antdv-next/icons";
import { Button, Input, Modal, Switch, Tabs, Tag, Tooltip, message } from "antdv-next";
import { computed, ref, watch } from "vue";
import { isMac, refreshAgents, saveSettings, store } from "../store";
import type { CustomAgent, Settings } from "../types";
import ProviderIcon from "./ProviderIcon.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [boolean] }>();

const tab = ref("agents");
const local = ref<Settings | null>(null);
const saving = ref(false);
const editingCmd = ref<Record<string, boolean>>({});

watch(
  () => props.open,
  (open) => {
    if (open && store.settings) {
      local.value = JSON.parse(JSON.stringify(store.settings)) as Settings;
      local.value.customAgents = local.value.customAgents ?? [];
      local.value.recentDirs = local.value.recentDirs ?? [];
      editingCmd.value = {};
      void refreshAgents();
    }
  },
);

const agents = computed(() => store.agents);

async function save() {
  if (!local.value) return;
  saving.value = true;
  try {
    await saveSettings(local.value);
    message.success("已保存");
    emit("update:open", false);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    saving.value = false;
  }
}

function addCustom() {
  if (!local.value) return;
  const agent: CustomAgent = { id: "", name: "", command: "", args: [], env: {} };
  local.value.customAgents = [...(local.value.customAgents ?? []), agent];
}

function removeCustom(i: number) {
  local.value?.customAgents?.splice(i, 1);
}

const overrideOf = (id: string) => local.value?.agents?.[id] ?? {};
function setOverride(id: string, patch: Record<string, unknown>) {
  if (!local.value) return;
  local.value.agents = { ...(local.value.agents ?? {}), [id]: { ...(local.value.agents?.[id] ?? {}), ...patch } };
}

function toggleCmdEditor(id: string) {
  editingCmd.value[id] = !editingCmd.value[id];
}

const modKey = computed(() => (isMac.value ? "⌘" : "Ctrl"));
</script>

<template>
  <Modal
    :open="props.open"
    :width="560"
    :footer="null"
    centered
    title="设置"
    class="settings-modal"
    @cancel="emit('update:open', false)"
  >
    <Tabs v-model:activeKey="tab" size="small" class="tabs">
      <Tabs.TabPane key="agents" tab="ACP 供应商">
        <div class="pane">
          <div class="pane-bar">
            <span class="hint">已安装且在 PATH 中的 Agent 可直接使用</span>
            <button class="link" @click="refreshAgents">
              <ReloadOutlined /> 重新检测
            </button>
          </div>

          <div class="agent-list">
            <div v-for="a in agents" :key="a.id" class="agent">
              <div class="agent-head">
                <span class="agent-ic-box">
                  <ProviderIcon :id="a.id" :name="a.name" :size="15" />
                </span>
                <span class="aname">{{ a.name }}</span>
                <Tag v-if="a.demo" color="blue" :bordered="false" class="mini-tag">演示</Tag>
                <Tag v-else-if="a.custom" :bordered="false" class="mini-tag">自定义</Tag>
                <span class="status-pill" :class="{ ok: a.available }">
                  <i class="status-dot" />
                  {{ a.available ? "已就绪" : "未安装" }}
                </span>
                <span class="spacer" />
                <Tooltip v-if="!a.custom && !a.demo" title="自定义启动命令">
                  <button
                    class="cmd-btn"
                    :class="{ active: editingCmd[a.id] || Boolean(overrideOf(a.id).command) }"
                    @click="toggleCmdEditor(a.id)"
                  >
                    <EditOutlined />
                  </button>
                </Tooltip>
                <Switch
                  v-if="!a.custom"
                  size="small"
                  :checked="!overrideOf(a.id).disabled"
                  @change="(v: unknown) => setOverride(a.id, { disabled: !v })"
                />
              </div>

              <div v-if="!a.custom && !a.demo && (editingCmd[a.id] || overrideOf(a.id).command)" class="override">
                <Input
                  size="small"
                  class="mono"
                  placeholder="覆盖启动命令（留空使用默认）"
                  :value="overrideOf(a.id).command ?? ''"
                  @change="(e: Event) => setOverride(a.id, { command: (e.target as HTMLInputElement).value, args: [] })"
                />
              </div>
            </div>
          </div>

          <div class="custom-section">
            <div class="custom-head">
              <span class="sub-title">自定义 Agent</span>
              <Button size="small" type="text" @click="addCustom">
                <template #icon><PlusOutlined /></template>
                添加
              </Button>
            </div>
            <div v-for="(c, i) in local?.customAgents ?? []" :key="i" class="custom">
              <Input v-model:value="c.name" placeholder="名称" size="small" style="width: 110px" />
              <Input v-model:value="c.command" placeholder="命令" size="small" class="mono" style="flex: 1" />
              <Input
                :value="(c.args ?? []).join(' ')"
                placeholder="参数"
                size="small"
                class="mono"
                style="flex: 1"
                @change="(e: Event) => (c.args = (e.target as HTMLInputElement).value.split(/\s+/).filter(Boolean))"
              />
              <Button size="small" type="text" danger @click="removeCustom(i)">
                <template #icon><DeleteOutlined /></template>
              </Button>
            </div>
          </div>
        </div>
      </Tabs.TabPane>

      <Tabs.TabPane key="general" tab="偏好">
        <div v-if="local" class="pane">
          <section class="row">
            <div class="label">
              <div class="title">发送快捷键</div>
              <div class="desc">输入框内按 Enter 或 Shift + Enter 发送</div>
            </div>
            <div class="seg-group" role="radiogroup" aria-label="发送快捷键">
              <button
                type="button"
                class="seg-btn"
                :class="{ active: local.sendKey === 'enter' }"
                @click="local.sendKey = 'enter'"
              >
                Enter
              </button>
              <button
                type="button"
                class="seg-btn"
                :class="{ active: local.sendKey !== 'enter' }"
                @click="local.sendKey = 'modEnter'"
              >
                ⇧ Shift + Enter
              </button>
            </div>
          </section>

          <section class="row">
            <div class="label">
              <div class="title">Node.js 路径</div>
              <div class="desc">
                {{ store.boot?.nodeError || `当前 ${store.boot?.nodeVersion || "未检测到"}，留空默认读 PATH` }}
              </div>
            </div>
            <Input v-model:value="local.nodePath" size="small" placeholder="默认 PATH" class="mono widen" />
          </section>

          <div class="meta-box">
            <div class="shortcuts">
              <span><kbd>{{ modKey }} N</kbd> 新对话</span>
              <span><kbd>{{ modKey }} K</kbd> 搜索</span>
              <span><kbd>{{ modKey }} B</kbd> 侧栏</span>
              <span><kbd>{{ modKey }} ,</kbd> 设置</span>
            </div>
            <div class="version mono">
              open-chat {{ store.boot?.version || "" }} · ACP
            </div>
          </div>
        </div>
      </Tabs.TabPane>
    </Tabs>

    <div class="footer">
      <span class="spacer" />
      <Button size="small" @click="emit('update:open', false)">取消</Button>
      <Button size="small" type="primary" :loading="saving" @click="save">保存</Button>
    </div>
  </Modal>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(54dvh, 420px);
  overflow-y: auto;
  padding: 2px 2px 2px 0;
}

.pane-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 2px;
}
.hint {
  font-size: 12px;
  color: var(--text-3);
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 6px;
  transition: background 0.12s, color 0.12s;
}
.link:hover {
  background: var(--hover);
  color: var(--text);
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.agent {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--hover);
  transition: border-color 0.14s;
}
.agent:hover {
  border-color: var(--border-strong);
}
.agent-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.agent-ic-box {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--modal-bg);
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.aname {
  font-size: 13px;
  font-weight: 550;
  color: var(--text);
}
.mini-tag {
  margin: 0;
  font-size: 10.5px;
  line-height: 18px;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-3);
}
.status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-3);
  opacity: 0.55;
}
.status-pill.ok {
  color: var(--ok);
}
.status-pill.ok .status-dot {
  background: var(--ok);
  opacity: 1;
}

.cmd-btn {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s, color 0.12s;
}
.cmd-btn:hover,
.cmd-btn.active {
  background: var(--active);
  color: var(--text);
}

.override {
  margin-top: 8px;
}

.custom-section {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.custom-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.sub-title {
  font-size: 12px;
  font-weight: 550;
  color: var(--text-2);
}
.custom {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.row:last-of-type {
  border-bottom: none;
}
.label {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: 13px;
  font-weight: 530;
}
.desc {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 1px;
}
.widen {
  width: 210px;
}

.seg-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 9px;
  background: var(--hover);
  border: 1px solid var(--border-strong);
  flex: none;
}
.seg-btn {
  height: 26px;
  padding: 0 11px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.16s var(--ease), color 0.16s var(--ease), box-shadow 0.16s var(--ease);
}
.seg-btn:hover:not(.active) {
  color: var(--text);
  background: var(--surface-2);
}
.seg-btn.active {
  background: var(--ink);
  color: var(--ink-inv);
  font-weight: 580;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
}

.meta-box {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  font-size: 11.5px;
  color: var(--text-3);
}
.shortcuts span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.version {
  font-size: 11px;
  color: var(--text-3);
}

.spacer {
  flex: 1;
}
.footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  margin-top: 8px;
  border-top: 1px solid var(--border);
}
</style>

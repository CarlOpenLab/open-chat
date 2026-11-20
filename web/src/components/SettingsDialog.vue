<script setup lang="ts">
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@antdv-next/icons";
import { Button, Dropdown, Input, Modal, Switch, Tabs, Tag, Tooltip, message } from "antdv-next";
import { computed, ref, watch } from "vue";
import { api } from "../api";
import { refreshAgents, saveSettings, store } from "../store";
import type { AgentUpdateChannel, AgentUpdateReport, AgentUpdateResult, CustomAgent, Settings } from "../types";
import ProviderIcon from "./ProviderIcon.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [boolean] }>();

const tab = ref("agents");
const local = ref<Settings | null>(null);
const saving = ref(false);
const editingCmd = ref<Record<string, boolean>>({});

// Agent CLI updater state
const updateReport = ref<AgentUpdateReport | null>(null);
const inspectingUpdates = ref(false);
const upgradingAll = ref(false);
const upgradingIds = ref<Record<string, boolean>>({});
const installingIds = ref<Record<string, boolean>>({});
const uninstallingIds = ref<Record<string, boolean>>({});
const uninstallTarget = ref<AgentUpdateResult | null>(null);
const miseBump = ref(true);

watch(
  () => props.open,
  (open) => {
    if (open && store.settings) {
      local.value = JSON.parse(JSON.stringify(store.settings)) as Settings;
      local.value.customAgents = local.value.customAgents ?? [];
      local.value.recentDirs = local.value.recentDirs ?? [];
      editingCmd.value = {};
      void refreshAgents();
      if (tab.value === "updates" && !updateReport.value) {
        void inspectUpdates();
      }
    }
  },
);

watch(tab, (next) => {
  if (props.open && next === "updates" && !updateReport.value && !inspectingUpdates.value) {
    void inspectUpdates();
  }
});

const agents = computed(() => store.agents);
const outdatedCount = computed(() => updateReport.value?.summary.outdated ?? 0);
const anyUpgrading = computed(
  () =>
    upgradingAll.value ||
    Object.values(upgradingIds.value).some(Boolean) ||
    Object.values(installingIds.value).some(Boolean) ||
    Object.values(uninstallingIds.value).some(Boolean),
);
const batchProgress = computed(() => (upgradingAll.value ? store.agentUpdateProgress : null));
const activeBatchId = computed(() =>
  upgradingAll.value && store.agentUpdateProgress?.stage !== "done"
    ? store.agentUpdateProgress?.agentId ?? ""
    : "",
);

function isAgentUpdating(id: string): boolean {
  return (
    Boolean(upgradingIds.value[id]) ||
    Boolean(installingIds.value[id]) ||
    Boolean(uninstallingIds.value[id]) ||
    activeBatchId.value === id
  );
}

function busyLabelOf(id: string): string {
  if (installingIds.value[id]) return "安装中…";
  if (uninstallingIds.value[id]) return "卸载中…";
  return "更新中…";
}

function progressOf(id: string) {
  return store.agentUpdateProgressById[id] ?? null;
}

watch(
  () => store.agentUpdateProgress,
  (p) => {
    if (!p?.result || !updateReport.value) return;
    const updated = p.result;
    const nextResults = updateReport.value.results.map((r) => (r.id === updated.id ? updated : r));
    updateReport.value = {
      ...updateReport.value,
      results: nextResults,
      summary: summarizeResults(nextResults),
    };
  },
);

async function inspectUpdates() {
  if (inspectingUpdates.value) return;
  inspectingUpdates.value = true;
  try {
    updateReport.value = await api.inspectAgentUpdates({ bump: miseBump.value });
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    inspectingUpdates.value = false;
  }
}

async function upgradeOne(item: AgentUpdateResult) {
  if (upgradingIds.value[item.id] || upgradingAll.value) return;
  upgradingIds.value = { ...upgradingIds.value, [item.id]: true };
  store.agentUpdateProgressById[item.id] = {
    stage: "inspecting",
    agentId: item.id,
    agentName: item.agent,
    completed: 0,
    total: 1,
    percent: 10,
    message: "准备更新…",
  };
  try {
    const res = await api.upgradeAgents({ only: [item.id], bump: miseBump.value });
    const updated = res.results?.[0];
    if (updated && updateReport.value) {
      const nextResults = updateReport.value.results.map((r) => (r.id === updated.id ? updated : r));
      updateReport.value = {
        ...updateReport.value,
        mise: res.mise ?? updateReport.value.mise,
        results: nextResults,
        summary: summarizeResults(nextResults),
        warnings: res.warnings?.length ? res.warnings : updateReport.value.warnings,
      };
    }
    if (updated?.status === "updated") {
      message.success(`${item.agent} 已更新到 ${updated.current ?? updated.target ?? "最新版"}`);
      void refreshAgents();
    } else if (updated?.status === "failed") {
      message.error(`${item.agent} 更新失败：${updated.note || "请检查终端输出"}`);
    } else if (updated?.note) {
      message.info(`${item.agent}：${updated.note}`);
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    upgradingIds.value = { ...upgradingIds.value, [item.id]: false };
    delete store.agentUpdateProgressById[item.id];
  }
}

async function upgradeAll() {
  if (upgradingAll.value || outdatedCount.value === 0) return;
  upgradingAll.value = true;
  store.agentUpdateProgress = {
    stage: "inspecting",
    completed: 0,
    total: outdatedCount.value,
    percent: 4,
    message: "准备更新…",
  };
  try {
    const res = await api.upgradeAgents({ bump: miseBump.value });
    updateReport.value = res;
    if (res.summary.updated > 0) {
      message.success(`已更新 ${res.summary.updated} 个 Agent`);
      void refreshAgents();
    } else if (res.summary.failed > 0) {
      message.error(`${res.summary.failed} 个 Agent 更新失败`);
    } else {
      message.info("没有需要更新的 Agent");
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    upgradingAll.value = false;
  }
}

function patchReportResult(updated: AgentUpdateResult) {
  if (!updateReport.value) return;
  const nextResults = updateReport.value.results.map((r) => (r.id === updated.id ? updated : r));
  updateReport.value = {
    ...updateReport.value,
    results: nextResults,
    summary: summarizeResults(nextResults),
  };
}

function installMenuFor(item: AgentUpdateResult) {
  const chs = item.installChannels ?? [];
  return {
    items: chs.map((ch) => ({
      key: ch,
      label: `通过 ${ch === "brew" ? "Homebrew" : ch} 安装`,
    })),
    onClick: ({ key }: { key: string }) => {
      void installOne(item, key as AgentUpdateChannel);
    },
  };
}

async function installOne(item: AgentUpdateResult, channel: AgentUpdateChannel) {
  if (isAgentUpdating(item.id) || upgradingAll.value) return;
  installingIds.value = { ...installingIds.value, [item.id]: true };
  store.agentUpdateProgressById[item.id] = {
    stage: "installing",
    agentId: item.id,
    agentName: item.agent,
    completed: 0,
    total: 1,
    percent: 12,
    message: `准备通过 ${channel} 安装 ${item.agent}…`,
  };
  try {
    const updated = await api.installAgent(item.id, channel);
    if (updated) patchReportResult(updated);
    message.success(`${item.agent} 已通过 ${channel} 安装完成`);
    void refreshAgents();
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    installingIds.value = { ...installingIds.value, [item.id]: false };
    delete store.agentUpdateProgressById[item.id];
  }
}

async function confirmUninstall() {
  const item = uninstallTarget.value;
  uninstallTarget.value = null;
  if (!item || isAgentUpdating(item.id) || upgradingAll.value) return;
  uninstallingIds.value = { ...uninstallingIds.value, [item.id]: true };
  store.agentUpdateProgressById[item.id] = {
    stage: "uninstalling",
    agentId: item.id,
    agentName: item.agent,
    completed: 0,
    total: 1,
    percent: 15,
    message: `准备卸载 ${item.agent}…`,
  };
  try {
    const updated = await api.uninstallAgent(item.id);
    if (updated) patchReportResult(updated);
    message.success(`${item.agent} 已卸载`);
    void refreshAgents();
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    uninstallingIds.value = { ...uninstallingIds.value, [item.id]: false };
    delete store.agentUpdateProgressById[item.id];
  }
}

function summarizeResults(results: AgentUpdateResult[]) {
  const s = { total: results.length, updated: 0, upToDate: 0, outdated: 0, skipped: 0, notInstalled: 0, failed: 0 };
  for (const r of results) {
    if (r.status === "updated") s.updated++;
    else if (r.status === "up-to-date" || r.status === "ahead") s.upToDate++;
    else if (r.status === "outdated") s.outdated++;
    else if (r.status === "skipped") s.skipped++;
    else if (r.status === "not-installed") s.notInstalled++;
    else if (r.status === "failed") s.failed++;
  }
  return s;
}

function statusText(status: AgentUpdateResult["status"]): string {
  switch (status) {
    case "updated":
      return "已更新";
    case "up-to-date":
      return "已是最新";
    case "ahead":
      return "高于最新";
    case "outdated":
      return "可更新";
    case "skipped":
      return "已跳过";
    case "failed":
      return "失败";
    case "not-installed":
      return "未安装";
  }
}

function channelText(ch?: AgentUpdateResult["channel"]): string {
  if (!ch) return "";
  if (ch === "unknown") return "未知渠道";
  return ch;
}

async function checkUpdates() {
  try {
    await api.checkUpdates();
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

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

</script>

<template>
  <Modal
    :open="props.open"
    :width="600"
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

      <Tabs.TabPane key="updates" tab="Agent 管理">
        <div class="pane">
          <div class="pane-bar">
            <span class="hint">
              按本机环境安装、原渠道升级或卸载 Agent
            </span>
            <div class="update-actions">
              <Tooltip title="开启后允许 mise upgrade --bump 改写全局 config.toml 中钉死的版本号">
                <label class="bump-toggle">
                  <span>mise bump</span>
                  <Switch v-model:checked="miseBump" size="small" :disabled="inspectingUpdates || anyUpgrading" />
                </label>
              </Tooltip>
              <button class="link" :disabled="inspectingUpdates || anyUpgrading" @click="inspectUpdates">
                <ReloadOutlined :spin="inspectingUpdates" /> 检查
              </button>
              <Button
                v-if="outdatedCount > 0"
                size="small"
                type="primary"
                :loading="upgradingAll"
                :disabled="inspectingUpdates || anyUpgrading"
                @click="upgradeAll"
              >
                全部更新 ({{ outdatedCount }})
              </Button>
            </div>
          </div>

          <div v-if="upgradingAll && batchProgress" class="update-progress">
            <div class="update-progress-head">
              <span class="update-progress-msg">{{ batchProgress.message || "正在批量更新 Agent…" }}</span>
              <span class="update-progress-pct mono">
                <template v-if="batchProgress.total > 0">{{ batchProgress.completed }}/{{ batchProgress.total }} · </template>
                {{ batchProgress.percent }}%
              </span>
            </div>
            <div class="update-progress-track">
              <div class="update-progress-fill" :style="{ width: `${Math.max(4, Math.min(100, batchProgress.percent))}%` }" />
            </div>
          </div>

          <div v-if="inspectingUpdates && !updateReport" class="update-empty">
            正在扫描本机 Agent 安装渠道与最新版本…
          </div>

          <div v-else-if="updateReport" class="agent-list">
            <div v-for="r in updateReport.results" :key="r.id" class="agent" :class="{ updating: isAgentUpdating(r.id) }">
              <div class="agent-head">
                <span class="agent-ic-box">
                  <ProviderIcon :id="r.id" :name="r.agent" :size="15" />
                </span>
                <span class="aname">{{ r.agent }}</span>
                <Tag v-if="r.channel" :bordered="false" class="mini-tag mono">
                  {{ channelText(r.channel) }}
                </Tag>
                <span v-if="isAgentUpdating(r.id)" class="status-pill busy">
                  <i class="status-dot" />
                  {{ busyLabelOf(r.id) }}
                </span>
                <span
                  v-else
                  class="status-pill"
                  :class="{
                    ok: r.status === 'up-to-date' || r.status === 'ahead' || r.status === 'updated',
                    warn: r.status === 'outdated' || r.status === 'skipped',
                    err: r.status === 'failed',
                  }"
                >
                  <i class="status-dot" />
                  {{ statusText(r.status) }}
                </span>
                <span class="spacer" />
                <span v-if="r.current" class="ver-text mono">
                  {{ r.current }}
                  <template v-if="r.target && r.target !== r.current"> → {{ r.target }}</template>
                </span>
                <Button
                  v-if="r.status === 'outdated'"
                  size="small"
                  type="primary"
                  :loading="Boolean(upgradingIds[r.id])"
                  :disabled="upgradingAll || inspectingUpdates || isAgentUpdating(r.id)"
                  @click="upgradeOne(r)"
                >
                  更新
                </Button>
                <template v-if="r.status === 'not-installed'">
                  <Dropdown
                    v-if="r.installChannels && r.installChannels.length > 1"
                    :menu="installMenuFor(r)"
                    :trigger="['click']"
                    placement="bottomRight"
                    :disabled="upgradingAll || inspectingUpdates || isAgentUpdating(r.id)"
                  >
                    <Button
                      size="small"
                      :loading="Boolean(installingIds[r.id])"
                      :disabled="upgradingAll || inspectingUpdates"
                    >
                      安装 ▾
                    </Button>
                  </Dropdown>
                  <Button
                    v-else-if="r.installChannels && r.installChannels.length === 1"
                    size="small"
                    :loading="Boolean(installingIds[r.id])"
                    :disabled="upgradingAll || inspectingUpdates"
                    @click="installOne(r, r.installChannels[0])"
                  >
                    安装 ({{ channelText(r.installChannels[0]) }})
                  </Button>
                  <Tooltip v-else title="未检测到可用的包管理器（mise / npm / pnpm / bun / brew）">
                    <Button size="small" disabled>无可用环境</Button>
                  </Tooltip>
                </template>
                <Tooltip v-if="r.canUninstall" :title="`通过 ${channelText(r.channel)} 卸载`">
                  <button
                    class="cmd-btn danger"
                    :disabled="upgradingAll || inspectingUpdates || isAgentUpdating(r.id)"
                    @click="uninstallTarget = r"
                  >
                    <DeleteOutlined />
                  </button>
                </Tooltip>
              </div>

              <div v-if="isAgentUpdating(r.id)" class="item-progress">
                <div class="item-progress-row">
                  <span class="item-progress-msg">{{ progressOf(r.id)?.message || "正在更新…" }}</span>
                  <span class="item-progress-pct mono">{{ progressOf(r.id)?.percent ?? 12 }}%</span>
                </div>
                <div class="update-progress-track slim">
                  <div
                    class="update-progress-fill"
                    :style="{ width: `${Math.max(8, Math.min(100, progressOf(r.id)?.percent ?? 12))}%` }"
                  />
                </div>
              </div>

              <div v-if="r.note || (r.shadowed && r.shadowed.length > 0)" class="update-meta">
                <div v-if="r.note" class="update-note">{{ r.note }}</div>
                <div v-if="r.shadowed && r.shadowed.length > 0" class="update-shadow">
                  另检测到未生效安装：{{ r.shadowed.map((s) => `${s.channel} (${s.path})`).join("；") }}
                </div>
              </div>
            </div>

            <div v-if="updateReport.warnings && updateReport.warnings.length > 0" class="update-warnings">
              <div v-for="(w, idx) in updateReport.warnings" :key="idx">{{ w }}</div>
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

          <section v-if="store.boot?.mode === 'desktop'" class="row">
            <div class="label">
              <div class="title">软件更新</div>
              <div class="desc">每日自动检查一次，发现新版本会弹窗提示</div>
            </div>
            <Button size="small" @click="checkUpdates">检查更新</Button>
          </section>

          <div class="meta-box">
            <div class="version mono">
              open-chat {{ store.boot?.version || "" }}
            </div>
            <div class="stack">
              基于 antdv-next、@antdv-next/x 与 @antdv-next/x-pro 构建
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

  <Modal
    :open="Boolean(uninstallTarget)"
    :title="`卸载 ${uninstallTarget?.agent ?? ''}？`"
    :width="380"
    centered
    ok-text="确认卸载"
    ok-type="danger"
    cancel-text="取消"
    @ok="confirmUninstall"
    @cancel="uninstallTarget = null"
  >
    <p class="muted" style="margin: 0">
      将通过原安装渠道 <b>{{ channelText(uninstallTarget?.channel) }}</b> 卸载 {{ uninstallTarget?.agent }}，不会删除你的历史对话记录。
    </p>
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
.link:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.update-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.bump-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-3);
  cursor: pointer;
}
.update-progress {
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.update-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.update-progress-msg {
  color: var(--text);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.update-progress-pct {
  font-size: 11px;
  color: var(--text-3);
  flex: none;
}
.update-progress-track {
  height: 5px;
  border-radius: 999px;
  background: var(--hover);
  overflow: hidden;
}
.update-progress-track.slim {
  height: 3.5px;
}
.update-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--ink);
  transition: width 0.35s var(--ease);
}
.item-progress {
  margin-top: 7px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.item-progress-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}
.item-progress-msg {
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-progress-pct {
  color: var(--text-3);
  flex: none;
}
.agent.updating {
  border-color: var(--border-strong);
}
.status-pill.busy {
  color: var(--text-2);
}
.status-pill.busy .status-dot {
  background: var(--ink);
  opacity: 1;
  animation: oc-pulse 1.2s ease-in-out infinite;
}
.update-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-3);
}
.ver-text {
  font-size: 11.5px;
  color: var(--text-2);
  white-space: nowrap;
}
.update-meta {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.45;
}
.update-note {
  color: var(--text-2);
}
.update-shadow {
  color: var(--text-3);
  word-break: break-all;
}
.update-warnings {
  margin-top: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--hover);
  border: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
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
.status-pill.warn {
  color: #d97706;
}
.status-pill.warn .status-dot {
  background: #d97706;
  opacity: 1;
}
.status-pill.err {
  color: #dc2626;
}
.status-pill.err .status-dot {
  background: #dc2626;
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
.cmd-btn:hover:not(:disabled),
.cmd-btn.active {
  background: var(--active);
  color: var(--text);
}
.cmd-btn.danger:hover:not(:disabled) {
  background: var(--err-soft);
  color: var(--err);
}
.cmd-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
  gap: 4px;
}
.version {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-2);
}
.stack {
  font-size: 11.5px;
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

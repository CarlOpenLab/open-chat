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
import { sendTestNotification } from "../notify";
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

const MANAGED_AGENT_SPECS = [
  { id: "claude-code", agent: "Claude Code" },
  { id: "codex", agent: "Codex" },
  { id: "opencode", agent: "OpenCode" },
  { id: "pi", agent: "Pi" },
  { id: "oh-my-pi", agent: "Oh My Pi" },
  { id: "codebuddy", agent: "CodeBuddy" },
  { id: "qoder", agent: "Qoder" },
  { id: "dsh", agent: "DeepSeek Harness" },
];

const agents = computed(() => store.agents);
const initialManagedAgents = computed(() =>
  MANAGED_AGENT_SPECS.map((spec) => {
    const known = store.agents.find((a) => a.id === spec.id);
    return { id: spec.id, agent: known?.name || spec.agent };
  }),
);
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

async function testNotify() {
  try {
    await sendTestNotification(local.value?.notifySound !== false);
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
    @cancel="emit('update:open', false)"
  >
    <Tabs v-model:activeKey="tab" size="small">
      <Tabs.TabPane key="agents" tab="ACP 供应商">
        <div class="flex flex-col gap-2 max-h-[min(54dvh,420px)] overflow-y-auto py-[2px] pr-[2px]">
          <div class="flex items-center justify-between gap-2 mb-[2px]">
            <span class="text-[12px] text-ink-3">已安装且在 PATH 中的 Agent 可直接使用</span>
            <button
              class="inline-flex items-center gap-1 border-0 bg-transparent text-ink-2 cursor-pointer text-[12px] px-1 py-[2px] rounded-[6px] transition-colors duration-120 hover:bg-hover hover:text-ink"
              @click="refreshAgents"
            >
              <ReloadOutlined /> 重新检测
            </button>
          </div>

          <div class="flex flex-col gap-[6px]">
            <div
              v-for="a in agents"
              :key="a.id"
              class="border border-solid border-line rounded-[10px] px-[10px] py-2 bg-hover transition-colors duration-140 hover:border-line-strong"
            >
              <div class="flex items-center gap-2">
                <span class="w-6 h-6 rounded-[7px] bg-modal border border-solid border-line inline-flex items-center justify-center flex-none">
                  <ProviderIcon :id="a.id" :name="a.name" :size="15" />
                </span>
                <span class="text-[13px] fw-550 text-ink">{{ a.name }}</span>
                <Tag v-if="a.demo" color="blue" :bordered="false" class="m-0 text-[10.5px] leading-[18px]">演示</Tag>
                <Tag v-else-if="a.custom" :bordered="false" class="m-0 text-[10.5px] leading-[18px]">自定义</Tag>
                <span class="inline-flex items-center gap-[5px] text-[11.5px]" :class="a.available ? 'text-ok' : 'text-ink-3'">
                  <i class="w-[5px] h-[5px] rounded-full" :class="a.available ? 'bg-ok opacity-100' : 'bg-ink-3 opacity-55'" />
                  {{ a.available ? "已就绪" : "未安装" }}
                </span>
                <span class="flex-1" />
                <Tooltip v-if="!a.custom && !a.demo" title="自定义启动命令">
                  <button
                    class="inline-grid place-items-center w-6 h-6 border-0 rounded-[6px] cursor-pointer text-[12px] transition-colors duration-120"
                    :class="
                      editingCmd[a.id] || Boolean(overrideOf(a.id).command)
                        ? 'bg-active text-ink'
                        : 'bg-transparent text-ink-3 hover:bg-active hover:text-ink'
                    "
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

              <div v-if="!a.custom && !a.demo && (editingCmd[a.id] || overrideOf(a.id).command)" class="mt-2">
                <Input
                  size="small"
                  class="font-mono"
                  placeholder="覆盖启动命令（留空使用默认）"
                  :value="overrideOf(a.id).command ?? ''"
                  @change="(e: Event) => setOverride(a.id, { command: (e.target as HTMLInputElement).value, args: [] })"
                />
              </div>
            </div>
          </div>

          <div class="mt-1 pt-2 border-0 border-t border-solid border-line">
            <div class="flex items-center justify-between mb-1">
              <span class="text-[12px] fw-550 text-ink-2">自定义 Agent</span>
              <Button size="small" type="text" @click="addCustom">
                <template #icon><PlusOutlined /></template>
                添加
              </Button>
            </div>
            <div v-for="(c, i) in local?.customAgents ?? []" :key="i" class="flex gap-[6px] mt-[6px]">
              <Input v-model:value="c.name" placeholder="名称" size="small" class="w-[110px]" />
              <Input v-model:value="c.command" placeholder="命令" size="small" class="font-mono flex-1" />
              <Input
                :value="(c.args ?? []).join(' ')"
                placeholder="参数"
                size="small"
                class="font-mono flex-1"
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
        <div class="flex flex-col gap-2 max-h-[min(54dvh,420px)] overflow-y-auto py-[2px] pr-[2px]">
          <div class="flex items-center justify-between gap-2 mb-[2px]">
            <span class="text-[12px] text-ink-3">按本机环境安装、原渠道升级或卸载 Agent</span>
            <div class="inline-flex items-center gap-2 flex-none">
              <Tooltip title="开启后允许 mise upgrade --bump 改写全局 config.toml 中钉死的版本号">
                <label class="inline-flex items-center gap-[5px] text-[11.5px] text-ink-3 cursor-pointer">
                  <span>mise bump</span>
                  <Switch v-model:checked="miseBump" size="small" :disabled="inspectingUpdates || anyUpgrading" />
                </label>
              </Tooltip>
              <button
                class="inline-flex items-center gap-1 border-0 bg-transparent text-ink-2 cursor-pointer text-[12px] px-1 py-[2px] rounded-[6px] transition-colors duration-120 hover:not-disabled:bg-hover hover:not-disabled:text-ink disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="inspectingUpdates || anyUpgrading"
                @click="inspectUpdates"
              >
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

          <div
            v-if="upgradingAll && batchProgress"
            class="px-[11px] py-[9px] rounded-[10px] border border-solid border-line-strong bg-surface-2 flex flex-col gap-[6px]"
          >
            <div class="flex items-center justify-between gap-2 text-[12px]">
              <span class="text-ink font-medium truncate">{{ batchProgress.message || "正在批量更新 Agent…" }}</span>
              <span class="text-[11px] text-ink-3 flex-none font-mono">
                <template v-if="batchProgress.total > 0">{{ batchProgress.completed }}/{{ batchProgress.total }} · </template>
                {{ batchProgress.percent }}%
              </span>
            </div>
            <div class="h-[5px] rounded-full bg-hover overflow-hidden">
              <div
                class="h-full rounded-full bg-ink-solid transition-[width] duration-350 ease-oc"
                :style="{ width: `${Math.max(4, Math.min(100, batchProgress.percent))}%` }"
              />
            </div>
          </div>

          <div v-if="!updateReport" class="flex flex-col gap-[6px]">
            <div
              v-for="item in initialManagedAgents"
              :key="item.id"
              class="border border-dashed border-line rounded-[10px] px-[10px] py-2 bg-hover opacity-62 pointer-events-none"
              aria-disabled="true"
            >
              <div class="flex items-center gap-2">
                <span class="w-6 h-6 rounded-[7px] bg-modal border border-solid border-line inline-flex items-center justify-center flex-none grayscale-[0.45] opacity-85">
                  <ProviderIcon :id="item.id" :name="item.agent" :size="15" />
                </span>
                <span class="text-[13px] fw-550 text-ink">{{ item.agent }}</span>
                <span
                  class="inline-block w-[34px] h-4 rounded-full bg-[linear-gradient(90deg,var(--hover)_0%,var(--active)_50%,var(--hover)_100%)] bg-[length:200%_100%] animate-[oc-shimmer_1.8s_linear_infinite]"
                  aria-hidden="true"
                />
                <span class="inline-flex items-center gap-[5px] text-[11.5px] text-ink-3">
                  <i class="w-[5px] h-[5px] rounded-full bg-ink-3 opacity-65 animate-oc-pulse-fast" />
                  <span>{{ inspectingUpdates ? "初始化检测中…" : "等待检测" }}</span>
                </span>
                <span class="flex-1" />
                <span
                  class="inline-block w-[52px] h-[14px] rounded-full bg-[linear-gradient(90deg,var(--hover)_0%,var(--active)_50%,var(--hover)_100%)] bg-[length:200%_100%] animate-[oc-shimmer_1.8s_linear_infinite]"
                  aria-hidden="true"
                />
                <Button size="small" disabled class="min-w-[58px]">
                  {{ inspectingUpdates ? "检测中" : "未检测" }}
                </Button>
              </div>
            </div>
          </div>

          <div v-else class="flex flex-col gap-[6px]">
            <div
              v-for="r in updateReport.results"
              :key="r.id"
              class="border border-solid rounded-[10px] px-[10px] py-2 bg-hover transition-colors duration-140 hover:border-line-strong"
              :class="isAgentUpdating(r.id) ? 'border-line-strong' : 'border-line'"
            >
              <div class="flex items-center gap-2">
                <span class="w-6 h-6 rounded-[7px] bg-modal border border-solid border-line inline-flex items-center justify-center flex-none">
                  <ProviderIcon :id="r.id" :name="r.agent" :size="15" />
                </span>
                <span class="text-[13px] fw-550 text-ink">{{ r.agent }}</span>
                <Tag v-if="r.channel" :bordered="false" class="m-0 text-[10.5px] leading-[18px] font-mono">
                  {{ channelText(r.channel) }}
                </Tag>
                <span v-if="isAgentUpdating(r.id)" class="inline-flex items-center gap-[5px] text-[11.5px] text-ink-2">
                  <i class="w-[5px] h-[5px] rounded-full bg-ink-solid opacity-100 animate-[oc-pulse_1.2s_ease-in-out_infinite]" />
                  {{ busyLabelOf(r.id) }}
                </span>
                <span
                  v-else
                  class="inline-flex items-center gap-[5px] text-[11.5px]"
                  :class="
                    r.status === 'up-to-date' || r.status === 'ahead' || r.status === 'updated'
                      ? 'text-ok'
                      : r.status === 'outdated' || r.status === 'skipped'
                        ? 'text-warn'
                        : r.status === 'failed'
                          ? 'text-err'
                          : 'text-ink-3'
                  "
                >
                  <i
                    class="w-[5px] h-[5px] rounded-full"
                    :class="
                      r.status === 'up-to-date' || r.status === 'ahead' || r.status === 'updated'
                        ? 'bg-ok opacity-100'
                        : r.status === 'outdated' || r.status === 'skipped'
                          ? 'bg-warn opacity-100'
                          : r.status === 'failed'
                            ? 'bg-err opacity-100'
                            : 'bg-ink-3 opacity-55'
                    "
                  />
                  {{ statusText(r.status) }}
                </span>
                <span class="flex-1" />
                <span v-if="r.current" class="text-[11.5px] text-ink-2 whitespace-nowrap font-mono">
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
                    class="inline-grid place-items-center w-6 h-6 border-0 rounded-[6px] bg-transparent text-ink-3 cursor-pointer text-[12px] transition-colors duration-120 hover:not-disabled:bg-err-soft hover:not-disabled:text-err disabled:opacity-40 disabled:cursor-not-allowed"
                    :disabled="upgradingAll || inspectingUpdates || isAgentUpdating(r.id)"
                    @click="uninstallTarget = r"
                  >
                    <DeleteOutlined />
                  </button>
                </Tooltip>
              </div>

              <div v-if="isAgentUpdating(r.id)" class="mt-[7px] pt-[6px] border-0 border-t border-dashed border-line flex flex-col gap-[5px]">
                <div class="flex items-center justify-between gap-2 text-[11px]">
                  <span class="text-ink-2 truncate">{{ progressOf(r.id)?.message || "正在更新…" }}</span>
                  <span class="text-ink-3 flex-none font-mono">{{ progressOf(r.id)?.percent ?? 12 }}%</span>
                </div>
                <div class="h-[3.5px] rounded-full bg-hover overflow-hidden">
                  <div
                    class="h-full rounded-full bg-ink-solid transition-[width] duration-350 ease-oc"
                    :style="{ width: `${Math.max(8, Math.min(100, progressOf(r.id)?.percent ?? 12))}%` }"
                  />
                </div>
              </div>

              <div v-if="r.note || (r.shadowed && r.shadowed.length > 0)" class="mt-[6px] pt-[6px] border-0 border-t border-dashed border-line flex flex-col gap-[3px] text-[11.5px] text-ink-3 leading-[1.45]">
                <div v-if="r.note" class="text-ink-2">{{ r.note }}</div>
                <div v-if="r.shadowed && r.shadowed.length > 0" class="text-ink-3 break-all">
                  另检测到未生效安装：{{ r.shadowed.map((s) => `${s.channel} (${s.path})`).join("；") }}
                </div>
              </div>
            </div>

            <div
              v-if="updateReport.warnings && updateReport.warnings.length > 0"
              class="mt-1 px-[10px] py-2 rounded-[8px] bg-hover border border-solid border-line text-[11.5px] text-ink-3 flex flex-col gap-[2px]"
            >
              <div v-for="(w, idx) in updateReport.warnings" :key="idx">{{ w }}</div>
            </div>
          </div>
        </div>
      </Tabs.TabPane>

      <Tabs.TabPane key="general" tab="偏好">
        <div v-if="local" class="flex flex-col gap-2 max-h-[min(54dvh,420px)] overflow-y-auto py-[2px] pr-[2px]">
          <section class="flex items-center gap-[14px] py-[10px] border-0 border-b border-solid border-line last-of-type:border-b-0">
            <div class="flex-1 min-w-0">
              <div class="text-[13px] fw-530">发送快捷键</div>
              <div class="text-[11.5px] text-ink-3 mt-[1px]">输入框内按 Enter 或 Shift + Enter 发送</div>
            </div>
            <div class="inline-flex items-center gap-[2px] p-[3px] rounded-[9px] bg-hover border border-solid border-line-strong flex-none" role="radiogroup" aria-label="发送快捷键">
              <button
                type="button"
                class="h-[26px] px-[11px] border-0 rounded-[6px] text-[12px] cursor-pointer whitespace-nowrap transition-all duration-160 ease-oc"
                :class="
                  local.sendKey === 'enter'
                    ? 'bg-ink-solid text-ink-inv fw-580 shadow-[0_1px_4px_rgba(0,0,0,0.24)]'
                    : 'bg-transparent text-ink-2 font-medium hover:text-ink hover:bg-surface-2'
                "
                @click="local.sendKey = 'enter'"
              >
                Enter
              </button>
              <button
                type="button"
                class="h-[26px] px-[11px] border-0 rounded-[6px] text-[12px] cursor-pointer whitespace-nowrap transition-all duration-160 ease-oc"
                :class="
                  local.sendKey !== 'enter'
                    ? 'bg-ink-solid text-ink-inv fw-580 shadow-[0_1px_4px_rgba(0,0,0,0.24)]'
                    : 'bg-transparent text-ink-2 font-medium hover:text-ink hover:bg-surface-2'
                "
                @click="local.sendKey = 'modEnter'"
              >
                ⇧ Shift + Enter
              </button>
            </div>
          </section>

          <template v-if="store.boot?.mode === 'desktop'">
            <section class="flex items-center gap-[14px] py-[10px] border-0 border-b border-solid border-line last-of-type:border-b-0">
              <div class="flex-1 min-w-0">
                <div class="text-[13px] fw-530">待确认通知（Need You）</div>
                <div class="text-[11.5px] text-ink-3 mt-[1px]">窗口在后台或切到其他对话时，Agent 等待确认立即发出系统通知</div>
              </div>
              <Switch v-model:checked="local.notifyNeedYou" size="small" />
            </section>

            <section class="flex items-center gap-[14px] py-[10px] border-0 border-b border-solid border-line last-of-type:border-b-0">
              <div class="flex-1 min-w-0">
                <div class="text-[13px] fw-530">会话完成通知</div>
                <div class="text-[11.5px] text-ink-3 mt-[1px]">窗口在后台或非当前对话完成回复、执行出错时发出系统通知</div>
              </div>
              <Switch v-model:checked="local.notifyTurnDone" size="small" />
            </section>

            <section class="flex items-center gap-[14px] py-[10px] border-0 border-b border-solid border-line last-of-type:border-b-0">
              <div class="flex-1 min-w-0">
                <div class="text-[13px] fw-530">通知提示音</div>
                <div class="text-[11.5px] text-ink-3 mt-[1px]">系统桌面通知附带提示音</div>
              </div>
              <div class="inline-flex items-center gap-[10px] flex-none">
                <Button
                  size="small"
                  :disabled="!local.notifyNeedYou && !local.notifyTurnDone"
                  @click="testNotify"
                >
                  测试通知
                </Button>
                <Switch
                  v-model:checked="local.notifySound"
                  size="small"
                  :disabled="!local.notifyNeedYou && !local.notifyTurnDone"
                />
              </div>
            </section>
          </template>

          <section class="flex items-center gap-[14px] py-[10px] border-0 border-b border-solid border-line last-of-type:border-b-0">
            <div class="flex-1 min-w-0">
              <div class="text-[13px] fw-530">Node.js 路径</div>
              <div class="text-[11.5px] text-ink-3 mt-[1px]">
                {{ store.boot?.nodeError || `当前 ${store.boot?.nodeVersion || "未检测到"}，留空默认读 PATH` }}
              </div>
            </div>
            <Input v-model:value="local.nodePath" size="small" placeholder="默认 PATH" class="font-mono w-[210px]" />
          </section>

          <section v-if="store.boot?.mode === 'desktop'" class="flex items-center gap-[14px] py-[10px] border-0 border-b border-solid border-line last-of-type:border-b-0">
            <div class="flex-1 min-w-0">
              <div class="text-[13px] fw-530">软件更新</div>
              <div class="text-[11.5px] text-ink-3 mt-[1px]">每日自动检查一次，发现新版本会弹窗提示</div>
            </div>
            <Button size="small" @click="checkUpdates">检查更新</Button>
          </section>

          <div class="mt-2 pt-[10px] border-0 border-t border-solid border-line flex flex-col gap-1">
            <div class="text-[11.5px] font-medium text-ink-2 font-mono">
              open-chat {{ store.boot?.version || "" }}
            </div>
            <div class="text-[11.5px] text-ink-3">
              基于 antdv-next、@antdv-next/x 与 @antdv-next/x-pro 构建
            </div>
          </div>
        </div>
      </Tabs.TabPane>
    </Tabs>

    <div class="flex items-center gap-2 pt-3 mt-2 border-0 border-t border-solid border-line">
      <span class="flex-1" />
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
    <p class="text-ink-2 m-0">
      将通过原安装渠道 <b>{{ channelText(uninstallTarget?.channel) }}</b> 卸载 {{ uninstallTarget?.agent }}，不会删除你的历史对话记录。
    </p>
  </Modal>
</template>

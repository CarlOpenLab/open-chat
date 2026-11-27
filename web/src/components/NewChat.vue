<script setup lang="ts">
import { CopyOutlined, DeleteOutlined, MenuUnfoldOutlined, WarningOutlined } from "@antdv-next/icons";
import { Checkbox, Input, Modal, Popover, Select, Switch, Tooltip, message } from "antdv-next";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { isMac, listWorktrees, refreshAgents, removeWorktreeByPath, start, store } from "../store";
import type { Block, WorktreeInfo } from "../types";
import Composer from "./Composer.vue";
import FolderPicker from "./FolderPicker.vue";
import WindowControls from "./WindowControls.vue";
const selected = ref<string>("");
const chosenModel = ref<{ configId: string; value: string } | null>(null);
const cwd = ref<string>("");
const draft = ref("");
const folderOpen = ref(false);
const busy = ref(false);

// Execution environment: optional isolated Git Worktree configured in the bar Popover
const isGitRepo = ref(false);
const gitBaseBranch = ref("");
const gitBranches = ref<string[]>([]);
const worktreeBaseBranch = ref("");
const worktreeEnabled = ref(false);
const worktreeBranchMode = ref<"detach" | "auto" | "custom">("detach");
const worktreeBranch = ref("");
const worktreeExistingPath = ref("");

const effectiveWorktreeBase = computed({
  get: () => worktreeBaseBranch.value || gitBaseBranch.value || "",
  set: (v: string) => {
    worktreeBaseBranch.value = v || "";
  },
});

const baseBranchOptions = computed(() => {
  const set = new Set<string>(gitBranches.value);
  if (gitBaseBranch.value) set.add(gitBaseBranch.value);
  if (worktreeBaseBranch.value) set.add(worktreeBaseBranch.value);
  return Array.from(set).map((b) => ({
    label: b === gitBaseBranch.value ? `${b}（当前）` : b,
    value: b,
  }));
});
const existingWorktrees = ref<WorktreeInfo[]>([]);
const wtPopoverOpen = ref(false);
const wtBranchInputRef = ref<{ focus?: () => void; input?: HTMLInputElement } | null>(null);

watch(selected, (id) => {
  const cached = store.cachedModels[id];
  chosenModel.value = cached?.currentValue != null ? { configId: cached.id, value: String(cached.currentValue) } : null;
});

watch(cwd, (p) => {
  if (p !== store.currentCwd) store.currentCwd = p;
});

watch(
  () => store.currentCwd,
  (p) => {
    if (p !== cwd.value) cwd.value = p;
  },
);

onMounted(() => {
  void refreshAgents();
  const preferred = store.preferredAgentId || store.settings?.defaultAgent || "";
  if (store.preferredAgentId) store.preferredAgentId = "";
  const available = store.agents.filter((a) => a.available && !a.disabled);
  selected.value = available.find((a) => a.id === preferred)?.id ?? available[0]?.id ?? store.agents[0]?.id ?? "";
  cwd.value = store.cwdInitialized
    ? store.currentCwd
    : store.currentCwd || store.settings?.recentDirs?.[0] || "";
});

async function loadExistingWorktrees() {
  if (!cwd.value || !isGitRepo.value) {
    existingWorktrees.value = [];
    return;
  }
  try {
    existingWorktrees.value = (await listWorktrees(cwd.value)) ?? [];
  } catch {
    existingWorktrees.value = [];
  }
}

watch(
  () => [isGitRepo.value, cwd.value] as const,
  ([repo], [, prevCwd]) => {
    if (cwd.value !== prevCwd) {
      worktreeBaseBranch.value = "";
    }
    if (!repo) {
      worktreeEnabled.value = false;
      worktreeBranchMode.value = "detach";
      worktreeBranch.value = "";
      worktreeBaseBranch.value = "";
      worktreeExistingPath.value = "";
      existingWorktrees.value = [];
      wtPopoverOpen.value = false;
    } else {
      void loadExistingWorktrees();
    }
  },
);

function setWorktreeMode(enabled: boolean) {
  worktreeEnabled.value = enabled;
  if (!enabled) {
    worktreeExistingPath.value = "";
  }
}

function onWtPopoverOpenChange(open: boolean) {
  wtPopoverOpen.value = open;
  if (open) {
    void loadExistingWorktrees();
  }
}

function selectAutoBranch() {
  worktreeEnabled.value = true;
  worktreeBranchMode.value = "auto";
  worktreeExistingPath.value = "";
  worktreeBranch.value = "";
  wtPopoverOpen.value = false;
}

function selectNoBranch() {
  worktreeEnabled.value = true;
  worktreeBranchMode.value = "detach";
  worktreeExistingPath.value = "";
  worktreeBranch.value = "";
  wtPopoverOpen.value = false;
}

function selectCustomBranch() {
  worktreeEnabled.value = true;
  worktreeBranchMode.value = "custom";
  worktreeExistingPath.value = "";
  void nextTick(() => {
    const el = wtBranchInputRef.value?.input;
    if (el) {
      el.focus();
      el.select();
    } else {
      wtBranchInputRef.value?.focus?.();
    }
  });
}

function selectExistingWorktree(wt: WorktreeInfo) {
  worktreeEnabled.value = true;
  worktreeExistingPath.value = wt.path;
  worktreeBranch.value = wt.branch || "";
  wtPopoverOpen.value = false;
}

const deletingWt = ref<WorktreeInfo | null>(null);
const deleteWtBranch = ref(false);
const deleteWtBusy = ref(false);

function confirmDeleteExistingWorktree(wt: WorktreeInfo) {
  wtPopoverOpen.value = false;
  deletingWt.value = wt;
  deleteWtBranch.value = false;
}

async function copyWorktreePath(path: string) {
  if (!path) return;
  try {
    await navigator.clipboard.writeText(path);
    message.success("已复制目录路径");
  } catch {
    message.error("复制失败");
  }
}

async function doDeleteExistingWorktree() {
  const wt = deletingWt.value;
  if (!wt || deleteWtBusy.value) return;
  deleteWtBusy.value = true;
  const label = wt.branch || wt.path.split("/").filter(Boolean).pop() || wt.path;
  try {
    await removeWorktreeByPath(wt.path, deleteWtBranch.value);
    if (worktreeExistingPath.value === wt.path) {
      worktreeExistingPath.value = "";
      worktreeBranch.value = "";
    }
    deletingWt.value = null;
    message.success(`已删除 Worktree ${label}`);
    await loadExistingWorktrees();
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    deleteWtBusy.value = false;
  }
}

const worktreeButtonLabel = computed(() => {
  if (!worktreeEnabled.value) return "Worktree";
  if (worktreeExistingPath.value) {
    const hit = existingWorktrees.value.find((w) => w.path === worktreeExistingPath.value);
    const name = hit?.branch || worktreeBranch.value;
    return name ? `Worktree · ${name}` : "Worktree";
  }
  if (worktreeBranchMode.value === "detach") {
    return effectiveWorktreeBase.value ? `Worktree · ${effectiveWorktreeBase.value}` : "Worktree · 不建分支";
  }
  if (worktreeBranchMode.value === "custom" && worktreeBranch.value.trim()) {
    return `Worktree · ${worktreeBranch.value.trim()}`;
  }
  return "Worktree";
});

const agents = computed(() => store.agents.filter((a) => !a.disabled));
const current = computed(() => agents.value.find((a) => a.id === selected.value));
const projectTitle = computed(() => {
  const home = store.boot?.home;
  if (!cwd.value || (home && cwd.value === home)) return "开始一个新任务";
  return cwd.value.split("/").filter(Boolean).pop() || "开始一个新任务";
});

async function send(blocks: Block[]) {
  if (busy.value) return;
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
    await start(
      current.value.id,
      cwd.value,
      blocks,
      chosenModel.value,
      worktreeEnabled.value
        ? {
            enabled: true,
            baseBranch: effectiveWorktreeBase.value,
            branchName: worktreeBranchMode.value === "custom" ? worktreeBranch.value.trim() : "",
            detach: worktreeBranchMode.value === "detach",
            existingPath: worktreeExistingPath.value || undefined,
          }
        : null,
    );
    draft.value = "";
    worktreeBranchMode.value = "detach";
    worktreeBranch.value = "";
    worktreeExistingPath.value = "";
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
  store.currentCwd = p;
  worktreeBaseBranch.value = "";
  worktreeBranchMode.value = "detach";
  worktreeBranch.value = "";
  worktreeExistingPath.value = "";
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
      <Tooltip :title="`工作区面板 (${isMac ? '⌘' : 'Ctrl'} J)`" :mouse-enter-delay="0.4">
        <button
          class="icon-btn text-[14px] no-drag"
          :class="{ 'text-ink': store.workspaceOpen }"
          aria-label="切换工作区面板"
          @click="store.workspaceOpen = !store.workspaceOpen"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.85"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-[15px] h-[15px] block"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M15 3v18" />
          </svg>
        </button>
      </Tooltip>
      <WindowControls />
    </header>

    <div class="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-7 pb-24 gap-[18px] animate-oc-rise [&>*]:w-full [&>*]:max-w-[680px]">
      <div class="text-center">
        <h1 class="m-0 text-[24px] font-semibold tracking-[-0.025em] text-ink leading-[1.3]">{{ projectTitle }}</h1>
      </div>

      <Composer
        v-model:value="draft"
        v-model:agent-id="selected"
        v-model:cwd="cwd"
        :worktree-mode="worktreeEnabled"
        :live="emptyLive"
        :agent-name="current?.name ?? '选择供应商'"
        :selected-model-value="chosenModel?.value"
        :recent-dirs="store.settings?.recentDirs ?? []"
        :sending="busy"
        :disabled="!current?.available"
        :placeholder="
          current?.available
            ? worktreeEnabled
              ? `在隔离 Worktree 中交给 ${current.name} 处理什么？`
              : `交给 ${current.name} 处理什么？`
            : '请在右下角选择一个已安装的 ACP 供应商…'
        "
        @git-branch="(b) => (gitBaseBranch = b)"
        @git-branches="(list) => (gitBranches = list)"
        @is-git-repo="(v) => (isGitRepo = v)"
        @send="send"
        @manage="store.settingsOpen = true"
        @pick-model="(cid, val) => (chosenModel = { configId: cid, value: val })"
        @pick-mode=""
        @cwd="folderOpen = true"
        @stop=""
      >
        <template #bar-extra="{ isGitRepo: repo }">
          <template v-if="repo">
            <span class="w-[1px] h-3 bg-line-strong mx-[2px]" />
            <Popover
              :open="wtPopoverOpen"
              trigger="click"
              placement="bottomLeft"
              :arrow="false"
              @open-change="onWtPopoverOpenChange"
            >
              <template #content>
                <div class="w-[292px] flex flex-col gap-3">
                  <!-- Header: Worktree toggle -->
                  <div class="flex items-center justify-between gap-2 pb-2 border-0 border-b border-solid border-line">
                    <div class="flex items-center gap-2 min-w-0">
                      <span
                        class="w-6 h-6 rounded-[7px] inline-grid place-items-center flex-none transition-colors duration-140"
                        :class="worktreeEnabled ? 'bg-ok-soft text-ok' : 'bg-hover text-ink-2'"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.85"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="w-[13.5px] h-[13.5px]"
                        >
                          <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
                          <circle cx="13" cy="12" r="2" />
                          <path d="M18 19c-2.8 0-5-2.2-5-5v8" />
                          <circle cx="20" cy="19" r="2" />
                        </svg>
                      </span>
                      <div class="flex flex-col min-w-0">
                        <span class="text-[12.5px] fw-580 text-ink leading-[1.25]">Worktree 隔离</span>
                        <span class="text-[10.5px] text-ink-3 leading-[1.35]">在独立目录运行，不改动主工作区</span>
                      </div>
                    </div>
                    <Switch
                      size="small"
                      :checked="worktreeEnabled"
                      @change="(checked) => setWorktreeMode(Boolean(checked))"
                    />
                  </div>

                  <!-- Base branch selector -->
                  <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-[11.5px] fw-500 text-ink-2 flex-none">基准分支</span>
                      <Select
                        v-model:value="effectiveWorktreeBase"
                        size="small"
                        show-search
                        :options="baseBranchOptions"
                        :disabled="Boolean(worktreeExistingPath)"
                        placeholder="选择基准分支"
                        class="w-[184px] font-mono text-[11.5px]"
                      />
                    </div>
                    <div v-if="worktreeExistingPath" class="text-[10.5px] text-ink-3 leading-[1.4]">
                      正在复用已有 Worktree，切换下方创建方式后可调整基准分支。
                    </div>
                  </div>

                  <!-- Branch creation mode -->
                  <div class="flex flex-col gap-1">
                    <div class="px-0.5 text-[10.5px] fw-500 text-ink-3">分支方式</div>

                    <button
                      type="button"
                      class="w-full flex items-center justify-between gap-2.5 px-2.5 py-[7px] rounded-[9px] border border-solid text-left cursor-pointer transition-all duration-120"
                      :class="
                        worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'detach'
                          ? 'bg-active border-line-strong text-ink'
                          : 'bg-transparent border-transparent text-ink-2 hover:bg-hover hover:text-ink'
                      "
                      @click="selectNoBranch"
                    >
                      <div class="flex flex-col gap-[1px] min-w-0">
                        <span class="text-[12px] fw-540 leading-[1.3]">不新建分支</span>
                        <span class="text-[10.5px] text-ink-3 leading-[1.35]">
                          直接使用基准分支（已检出时自动游离 HEAD）
                        </span>
                      </div>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="w-[13px] h-[13px] text-ok flex-none transition-opacity duration-120"
                        :class="worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'detach' ? 'opacity-100' : 'opacity-0'"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      class="w-full flex items-center justify-between gap-2.5 px-2.5 py-[7px] rounded-[9px] border border-solid text-left cursor-pointer transition-all duration-120"
                      :class="
                        worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'auto'
                          ? 'bg-active border-line-strong text-ink'
                          : 'bg-transparent border-transparent text-ink-2 hover:bg-hover hover:text-ink'
                      "
                      @click="selectAutoBranch"
                    >
                      <div class="flex flex-col gap-[1px] min-w-0">
                        <span class="text-[12px] fw-540 leading-[1.3]">自动生成分支</span>
                        <span class="text-[10.5px] font-mono text-ink-3 leading-[1.35]">基于基准分支切出 wt/自动命名</span>
                      </div>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="w-[13px] h-[13px] text-ok flex-none transition-opacity duration-120"
                        :class="worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'auto' ? 'opacity-100' : 'opacity-0'"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>

                    <div
                      class="flex flex-col gap-1.5 px-2.5 py-[7px] rounded-[9px] border border-solid transition-all duration-120"
                      :class="
                        worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'custom'
                          ? 'bg-active border-line-strong text-ink'
                          : 'bg-transparent border-transparent text-ink-2 hover:bg-hover hover:text-ink'
                      "
                    >
                      <button
                        type="button"
                        class="w-full flex items-center justify-between gap-2.5 p-0 border-0 bg-transparent text-left text-inherit cursor-pointer"
                        @click="selectCustomBranch"
                      >
                        <div class="flex flex-col gap-[1px] min-w-0">
                          <span class="text-[12px] fw-540 leading-[1.3]">自定义分支名</span>
                          <span
                            v-if="!(worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'custom')"
                            class="text-[10.5px] text-ink-3 leading-[1.35]"
                          >
                            手动指定要切出的新分支名
                          </span>
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="w-[13px] h-[13px] text-ok flex-none transition-opacity duration-120"
                          :class="worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'custom' ? 'opacity-100' : 'opacity-0'"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                      <Input
                        v-if="worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'custom'"
                        ref="wtBranchInputRef"
                        v-model:value="worktreeBranch"
                        size="small"
                        class="font-mono text-[11.5px]"
                        placeholder="例如 feat/auth"
                        @press-enter="wtPopoverOpen = false"
                      />
                    </div>
                  </div>

                  <template v-if="existingWorktrees.length > 0">
                    <div class="h-[1px] bg-line" />
                    <div class="flex flex-col gap-1">
                      <div class="px-0.5 text-[10.5px] fw-500 text-ink-3">已有 Worktree</div>
                      <div class="flex flex-col gap-0.5 max-h-[140px] overflow-y-auto">
                        <div
                          v-for="wt in existingWorktrees"
                          :key="wt.path"
                          class="group/wt flex items-center gap-1 rounded-[8px] border border-solid transition-colors duration-120"
                          :class="
                            worktreeEnabled && worktreeExistingPath === wt.path
                              ? 'bg-active border-line-strong text-ink'
                              : 'bg-transparent border-transparent text-ink-2 hover:bg-hover hover:text-ink'
                          "
                        >
                          <button
                            type="button"
                            class="flex-1 min-w-0 flex items-center justify-between gap-2 px-2 py-[5px] border-0 bg-transparent text-left text-inherit cursor-pointer"
                            @click="selectExistingWorktree(wt)"
                          >
                            <span class="text-[11.5px] font-mono truncate min-w-0">{{ wt.branch || "HEAD" }}</span>
                            <span
                              class="text-[10.5px] flex-none"
                              :class="wt.dirty ? 'text-warn' : 'text-ink-3'"
                            >
                              {{ wt.dirty ? `${wt.changedCount} 处改动` : "干净" }}
                            </span>
                          </button>
                          <Tooltip title="删除此 Worktree" :mouse-enter-delay="0.35">
                            <button
                              type="button"
                              class="inline-grid place-items-center w-6 h-6 mr-1 border-0 rounded-[5px] bg-transparent text-ink-3 opacity-60 cursor-pointer flex-none transition-all duration-120 hover:opacity-100 hover:bg-err-soft hover:text-err"
                              aria-label="删除 Worktree"
                              @click.stop="confirmDeleteExistingWorktree(wt)"
                            >
                              <DeleteOutlined class="text-[11.5px]" />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </template>

              <Tooltip
                :title="worktreeEnabled ? 'Worktree 隔离已开启，点击调整分支或关闭' : '开启 Git Worktree 隔离工作区'"
                :mouse-enter-delay="0.35"
              >
                <button
                  type="button"
                  class="inline-flex items-center gap-[5px] h-6 px-2 border border-solid rounded-[7px] text-[11.5px] cursor-pointer flex-[0_1_auto] min-w-0 max-w-[170px] transition-all duration-140 ease-oc"
                  :class="
                    worktreeEnabled
                      ? 'bg-surface-strong text-ink fw-560 border-line-strong shadow-card'
                      : 'border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:border-line hover:text-ink'
                  "
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.85"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="w-[12.5px] h-[12.5px] flex-none transition-colors duration-140"
                    :class="worktreeEnabled ? 'text-ok' : ''"
                  >
                    <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
                    <circle cx="13" cy="12" r="2" />
                    <path d="M18 19c-2.8 0-5-2.2-5-5v8" />
                    <circle cx="20" cy="19" r="2" />
                  </svg>
                  <span class="truncate" :class="{ 'font-mono': worktreeButtonLabel !== 'Worktree' }">{{ worktreeButtonLabel }}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[11px] h-[11px] opacity-65 flex-none">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </Tooltip>
            </Popover>
          </template>
        </template>
      </Composer>

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

    <Modal
      :open="Boolean(deletingWt)"
      title="删除 Worktree"
      :width="420"
      centered
      ok-text="删除"
      ok-type="primary"
      :ok-button-props="{ danger: true }"
      cancel-text="取消"
      :confirm-loading="deleteWtBusy"
      @ok="doDeleteExistingWorktree"
      @cancel="deletingWt = null"
    >
      <div v-if="deletingWt" class="flex flex-col gap-3 pt-1">
        <p class="m-0 text-[12.5px] text-ink-2 leading-[1.55]">
          将永久移除该本地隔离目录，不会影响原仓库中的文件。
        </p>

        <div class="rounded-[10px] bg-surface-2 border border-solid border-line overflow-hidden">
          <div class="px-3 py-2.5 flex flex-col gap-1">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] text-ink-3">隔离目录</span>
              <Tooltip title="复制目录路径" :mouse-enter-delay="0.3">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 h-5 px-1.5 border-0 rounded-[5px] bg-transparent text-[11px] text-ink-3 cursor-pointer flex-none transition-colors duration-120 hover:bg-hover hover:text-ink"
                  aria-label="复制目录路径"
                  @click="copyWorktreePath(deletingWt.path)"
                >
                  <CopyOutlined class="text-[11px]" />
                  <span>复制</span>
                </button>
              </Tooltip>
            </div>
            <span class="font-mono text-[11.5px] text-ink break-all leading-[1.5]">{{ deletingWt.path }}</span>
          </div>

          <div
            v-if="deletingWt.dirty"
            class="px-3 py-2.5 border-0 border-t border-solid border-line flex items-start gap-2"
          >
            <WarningOutlined class="flex-none text-warn mt-[2px] text-[13px]" />
            <div class="flex flex-col gap-0.5 leading-[1.45]">
              <span class="text-[12px] fw-540 text-ink">存在 {{ deletingWt.changedCount }} 处未提交的代码改动</span>
              <span class="text-[11.5px] text-ink-3">删除目录后这些改动将永久丢失，无法通过 Git 恢复。</span>
            </div>
          </div>

          <div
            v-if="deletingWt.branch && deletingWt.branch !== 'HEAD'"
            class="px-3 py-2.5 border-0 border-t border-solid border-line"
          >
            <Checkbox v-model:checked="deleteWtBranch">
              <span class="text-[12px] text-ink-2">
                同时删除分支 <code class="font-mono text-ink">{{ deletingWt.branch }}</code>
              </span>
            </Checkbox>
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>

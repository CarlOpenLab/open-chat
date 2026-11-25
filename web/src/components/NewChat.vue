<script setup lang="ts">
import { MenuUnfoldOutlined } from "@antdv-next/icons";
import { Input, Popover, Switch, Tooltip, message } from "antdv-next";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { isMac, listWorktrees, refreshAgents, start, store } from "../store";
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
const worktreeEnabled = ref(false);
const worktreeBranchMode = ref<"auto" | "custom">("auto");
const worktreeBranch = ref("");
const worktreeExistingPath = ref("");
const existingWorktrees = ref<WorktreeInfo[]>([]);
const loadingWorktrees = ref(false);
const wtPopoverOpen = ref(false);
const wtBranchInputRef = ref<{ focus?: () => void; input?: HTMLInputElement } | null>(null);

watch(selected, (id) => {
  const cached = store.cachedModels[id];
  chosenModel.value = cached?.currentValue != null ? { configId: cached.id, value: String(cached.currentValue) } : null;
});

onMounted(() => {
  void refreshAgents();
  const preferred = store.settings?.defaultAgent ?? "";
  const available = store.agents.filter((a) => a.available && !a.disabled);
  selected.value = available.find((a) => a.id === preferred)?.id ?? available[0]?.id ?? store.agents[0]?.id ?? "";
  cwd.value = store.currentCwd || store.settings?.recentDirs?.[0] || store.boot?.home || "";
});

async function loadExistingWorktrees() {
  if (!cwd.value || !isGitRepo.value) {
    existingWorktrees.value = [];
    return;
  }
  loadingWorktrees.value = true;
  try {
    existingWorktrees.value = (await listWorktrees(cwd.value)) ?? [];
  } catch {
    existingWorktrees.value = [];
  } finally {
    loadingWorktrees.value = false;
  }
}

watch(
  () => [isGitRepo.value, cwd.value] as const,
  ([repo]) => {
    if (!repo) {
      worktreeEnabled.value = false;
      worktreeBranchMode.value = "auto";
      worktreeBranch.value = "";
      worktreeExistingPath.value = "";
      existingWorktrees.value = [];
      wtPopoverOpen.value = false;
    } else if (worktreeEnabled.value) {
      void loadExistingWorktrees();
    }
  },
);

function setWorktreeMode(enabled: boolean) {
  worktreeEnabled.value = enabled;
  if (!enabled) {
    worktreeExistingPath.value = "";
  } else {
    void loadExistingWorktrees();
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

const worktreeButtonLabel = computed(() => {
  if (!worktreeEnabled.value) return "Worktree";
  if (worktreeExistingPath.value) {
    const hit = existingWorktrees.value.find((w) => w.path === worktreeExistingPath.value);
    const name = hit?.branch || worktreeBranch.value;
    return name ? `Worktree · ${name}` : "Worktree";
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
            baseBranch: gitBaseBranch.value,
            branchName: worktreeBranchMode.value === "custom" ? worktreeBranch.value.trim() : "",
            existingPath: worktreeExistingPath.value || undefined,
          }
        : null,
    );
    draft.value = "";
    worktreeBranchMode.value = "auto";
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
  worktreeBranchMode.value = "auto";
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
                <div class="w-[268px] flex flex-col gap-2.5">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.85"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="w-[14px] h-[14px] flex-none transition-colors duration-140"
                        :class="worktreeEnabled ? 'text-ok' : 'text-ink-2'"
                      >
                        <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
                        <circle cx="13" cy="12" r="2" />
                        <path d="M18 19c-2.8 0-5-2.2-5-5v8" />
                        <circle cx="20" cy="19" r="2" />
                      </svg>
                      <span class="text-[12.5px] fw-560 text-ink">Worktree 隔离</span>
                    </div>
                    <Switch
                      size="small"
                      :checked="worktreeEnabled"
                      @change="(checked) => setWorktreeMode(Boolean(checked))"
                    />
                  </div>

                  <div class="text-[11px] text-ink-3 -mt-1.5 leading-[1.45]">
                    基于 <code class="font-mono text-ink-2">{{ gitBaseBranch || "HEAD" }}</code> 在独立目录运行，不干扰主工作区。
                  </div>

                  <div class="flex flex-col gap-1">
                    <button
                      type="button"
                      class="w-full flex items-center justify-between gap-2 px-2.5 py-[6px] rounded-[8px] border border-solid text-left cursor-pointer transition-colors duration-120"
                      :class="
                        worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'auto'
                          ? 'bg-active border-line-strong text-ink'
                          : 'bg-transparent border-transparent text-ink-2 hover:bg-hover hover:text-ink'
                      "
                      @click="selectAutoBranch"
                    >
                      <div class="flex flex-col min-w-0">
                        <span class="text-[12px] fw-520">自动生成分支</span>
                        <span class="text-[10.5px] font-mono text-ink-3">wt/自动命名</span>
                      </div>
                      <svg
                        v-if="worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'auto'"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="w-[13px] h-[13px] text-ok flex-none"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>

                    <div
                      class="flex flex-col gap-1.5 px-2.5 py-[6px] rounded-[8px] border border-solid transition-colors duration-120"
                      :class="
                        worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'custom'
                          ? 'bg-active border-line-strong text-ink'
                          : 'bg-transparent border-transparent text-ink-2 hover:bg-hover hover:text-ink'
                      "
                    >
                      <button
                        type="button"
                        class="w-full flex items-center justify-between gap-2 p-0 border-0 bg-transparent text-left text-inherit cursor-pointer"
                        @click="selectCustomBranch"
                      >
                        <span class="text-[12px] fw-520">自定义分支名</span>
                        <svg
                          v-if="worktreeEnabled && !worktreeExistingPath && worktreeBranchMode === 'custom'"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="w-[13px] h-[13px] text-ok flex-none"
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
                    <div class="h-[1px] bg-line -mx-1" />
                    <div class="flex flex-col gap-1">
                      <div class="px-1 text-[10.5px] text-ink-3">复用已有 Worktree</div>
                      <div class="flex flex-col gap-0.5 max-h-[128px] overflow-y-auto">
                        <button
                          v-for="wt in existingWorktrees"
                          :key="wt.path"
                          type="button"
                          class="w-full flex items-center justify-between gap-2 px-2 py-[5px] rounded-[7px] border border-solid text-left cursor-pointer transition-colors duration-120"
                          :class="
                            worktreeEnabled && worktreeExistingPath === wt.path
                              ? 'bg-active border-line-strong text-ink'
                              : 'bg-transparent border-transparent text-ink-2 hover:bg-hover hover:text-ink'
                          "
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
                      </div>
                    </div>
                  </template>
                  <div v-else-if="loadingWorktrees" class="text-[11px] text-ink-3 px-1">
                    正在检查已有 Worktree…
                  </div>
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
  </div>
</template>

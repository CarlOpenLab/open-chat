<script setup lang="ts">
import {
  CopyOutlined,
  FolderOpenOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
  WarningOutlined,
} from "@antdv-next/icons";
import { MessageScroller } from "@antdv-next/x-pro";
import type { MessageScrollerItem, MessageScrollerRef } from "@antdv-next/x-pro";
import { Checkbox, Dropdown, Modal, Tooltip, message } from "antdv-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "../api";
import {
  activeLive,
  activeMeta,
  activeTranscript,
  cancel,
  connect,
  enqueueMessage,
  isArchived,
  isMac,
  newConversationInDir,
  pin,
  popQueuedToDraft,
  remove,
  removeQueued,
  removeWorktree,
  rename,
  respond,
  select,
  send,
  setArchived,
  setConfig,
  setMode,
  start,
  steerQueued,
  store,
  worktreeStatus,
} from "../store";
import { answerText, userText } from "../transcript";
import type { Block, PermissionOption, WorktreeStatus } from "../types";
import Composer from "./Composer.vue";
import FolderPicker from "./FolderPicker.vue";
import ProviderIcon from "./ProviderIcon.vue";
import TurnView from "./TurnView.vue";
import WindowControls from "./WindowControls.vue";

const meta = computed(() => activeMeta.value!);
const live = computed(() => activeLive.value);
const transcript = computed(() => activeTranscript.value);

const scroller = ref<MessageScrollerRef | null>(null);
const following = ref(true);
const canScroll = ref(false);
const editing = ref(false);
const titleDraft = ref("");
const folderOpen = ref(false);

const INITIAL_RENDER_TURNS = 10;
const LOAD_MORE_STEP = 15;
const renderLimit = ref(INITIAL_RENDER_TURNS);

const running = computed(() => live.value.status === "running");
const turns = computed(() => transcript.value?.turns ?? []);
const hiddenTurnCount = computed(() => Math.max(0, turns.value.length - renderLimit.value));
const visibleTurns = computed(() =>
  hiddenTurnCount.value > 0 ? turns.value.slice(hiddenTurnCount.value) : turns.value,
);
const loadingHistory = computed(() => Boolean(store.loading[meta.value.id]) && !transcript.value);
const queuedMessages = computed(() => store.queues[meta.value.id] ?? []);

async function loadOlderTurns(count = LOAD_MORE_STEP) {
  if (hiddenTurnCount.value <= 0) return;
  const vp = scroller.value?.viewportElement;
  const prevHeight = vp?.scrollHeight ?? 0;
  const prevTop = vp?.scrollTop ?? 0;
  renderLimit.value += count;
  await nextTick();
  if (vp) {
    const delta = vp.scrollHeight - prevHeight;
    if (delta > 0) vp.scrollTop = prevTop + delta;
  }
  updateScrollable();
}

function onEnqueue(blocks: Block[]) {
  enqueueMessage(meta.value.id, blocks);
}

async function onSteer(queueId: string) {
  try {
    await steerQueued(meta.value.id, queueId);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

const pendingPerms = computed(() => {
  const list: {
    turnId: string;
    requestId: string;
    title: string;
    detail?: string;
    options: PermissionOption[];
  }[] = [];
  for (const t of turns.value) {
    for (const seg of t.segments) {
      if (seg.kind === "permission" && !seg.resolved) {
        list.push({
          turnId: t.id,
          requestId: seg.requestId,
          title: seg.toolCall?.title || seg.toolCall?.kind || "需要你的确认",
          detail: seg.toolCall?.locations?.[0]?.path,
          options: seg.options,
        });
      }
    }
  }
  return list;
});

async function onRespondPermission(requestId: string, optionId: string) {
  try {
    await respond(meta.value.id, requestId, optionId);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

let jumpLockUntil = 0;

function onFollowUpdate(next: boolean) {
  if (next && performance.now() < jumpLockUntil) return;
  following.value = next;
}

function scrollToTurnStart(turnId: string | number, smooth = true) {
  const vp = scroller.value?.viewportElement;
  const content = scroller.value?.contentElement;
  if (!vp || !content) return;
  const id = String(turnId);
  const turnEl = Array.from(content.querySelectorAll<HTMLElement>("[data-message-id]")).find(
    (el) => el.getAttribute("data-message-id") === id,
  );
  if (!turnEl) return;
  const anchorEl = turnEl.querySelector<HTMLElement>(".mine") ?? turnEl;
  const vpRect = vp.getBoundingClientRect();
  const elRect = anchorEl.getBoundingClientRect();
  const maxTop = Math.max(0, vp.scrollHeight - vp.clientHeight);
  const targetTop = Math.min(maxTop, Math.max(0, vp.scrollTop + elRect.top - vpRect.top - 16));
  const atBottom = maxTop - targetTop <= 56;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const behavior: ScrollBehavior = smooth && !reducedMotion ? "smooth" : "auto";

  if (!atBottom) {
    jumpLockUntil = performance.now() + (behavior === "smooth" ? 400 : 100);
    following.value = false;
  } else {
    jumpLockUntil = 0;
  }

  vp.scrollTo({ top: targetTop, behavior });
}

async function ensureTurnRendered(turnId: string | number) {
  const id = String(turnId);
  const idx = turns.value.findIndex((t) => t.id === id);
  if (idx >= 0 && idx < hiddenTurnCount.value) {
    renderLimit.value = turns.value.length - idx;
    await nextTick();
  }
}

async function jumpToTurn(turnId: string) {
  await ensureTurnRendered(turnId);
  scrollToTurnStart(turnId, true);
}

function onRailItemSelect(id: string | number) {
  // Run after MessageScroller's synchronous handleRailItemClick (which centers the full
  // turn or jumps to the bottom on the last item) so we always land at the message start.
  void ensureTurnRendered(id).then(() => nextTick()).then(() => {
    scrollToTurnStart(id, true);
  });
}

const scrollerItems = computed<MessageScrollerItem[]>(() =>
  turns.value.map((t, i) => {
    const prompt = userText(t.user?.blocks ?? []).replace(/\s+/g, " ").trim();
    const reply = answerText(t).replace(/\s+/g, " ").trim();
    return {
      id: t.id,
      title: prompt ? (prompt.length > 36 ? `${prompt.slice(0, 36)}…` : prompt) : `第 ${i + 1} 轮对话`,
      description: reply ? (reply.length > 56 ? `${reply.slice(0, 56)}…` : reply) : undefined,
    };
  }),
);

const draft = computed({
  get: () => store.drafts[meta.value.id] ?? "",
  set: (v: string) => (store.drafts[meta.value.id] = v),
});

const shortCwd = computed(() => {
  const home = store.boot?.home;
  const p = meta.value.cwd;
  if (!p) return "";
  if (home && p === home) return "~";
  if (home && p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
});

function updateScrollable() {
  const vp = scroller.value?.viewportElement;
  if (!vp) {
    canScroll.value = false;
    return;
  }
  const scrollable = vp.scrollHeight - vp.clientHeight > 24;
  canScroll.value = scrollable;
  if (!scrollable && !following.value) {
    following.value = true;
  }
}

function scrollToBottom(smooth = false) {
  jumpLockUntil = 0;
  scroller.value?.setFollowing(true);
  scroller.value?.scrollToEnd({ behavior: smooth ? "smooth" : "auto" });
}

watch(
  () => [meta.value.id, transcript.value?.version, turns.value.length],
  async () => {
    await nextTick();
    updateScrollable();
  },
);

watch(
  () => meta.value.id,
  async (id) => {
    editing.value = false;
    folderOpen.value = false;
    deleting.value = false;
    renderLimit.value = INITIAL_RENDER_TURNS;
    await nextTick();
    scrollToBottom(false);
    updateScrollable();
    // Defer ACP session connect by one frame so the switched conversation paints first.
    requestAnimationFrame(() => {
      if (meta.value?.id === id && live.value.status === "idle") void connect(id);
    });
  },
);

onMounted(async () => {
  await nextTick();
  scrollToBottom();
  updateScrollable();
  window.addEventListener("resize", updateScrollable);
  const id = meta.value.id;
  requestAnimationFrame(() => {
    if (meta.value?.id === id && live.value.status === "idle") void connect(id);
  });
});
onBeforeUnmount(() => window.removeEventListener("resize", updateScrollable));

const usage = computed(() => live.value.usage ?? null);
const contextPct = computed(() => {
  const w = usage.value?.contextWindow;
  if (!w || !w.total) return null;
  return Math.min(100, Math.round((w.used / w.total) * 100));
});
const usageLabel = computed(() => {
  const w = usage.value?.contextWindow;
  if (!w) return "";
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  const cost = usage.value?.costUsd ? ` · $${usage.value.costUsd.toFixed(2)}` : "";
  return `上下文 ${k(w.used)} / ${k(w.total)}${cost}`;
});

function startEdit() {
  titleDraft.value = meta.value.title;
  editing.value = true;
  void nextTick(() => {
    const el = document.getElementById("title-edit") as HTMLInputElement | null;
    if (!el) return;
    el.focus();
    el.select();
  });
}

function cancelEdit() {
  editing.value = false;
  titleDraft.value = meta.value.title;
}

async function commitTitle() {
  if (!editing.value) return;
  editing.value = false;
  const t = titleDraft.value.trim();
  if (t && t !== meta.value.title) await rename(meta.value.id, t);
}

function onTitleKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === "Enter") {
    e.preventDefault();
    void commitTitle();
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelEdit();
  }
}

async function onSend(blocks: Block[]) {
  await nextTick();
  scrollToBottom();
  try {
    await send(meta.value.id, blocks);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

async function retry(blocks: Block[]) {
  await send(meta.value.id, blocks);
}

async function reveal() {
  if (!meta.value.cwd) return;
  try {
    await api.reveal(meta.value.cwd);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

function newSameDir() {
  newConversationInDir(meta.value.worktreeRepo || meta.value.cwd, meta.value.agentId);
}

async function onPickModel(configId: string, value: string) {
  try {
    await setConfig(meta.value.id, configId, value);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

async function onPickMode(modeId: string) {
  try {
    await setMode(meta.value.id, modeId);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

const archived = computed(() => isArchived(meta.value.id));

async function toggleArchive() {
  const next = !archived.value;
  try {
    await setArchived(meta.value.id, next);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
    return;
  }
  message.success(next ? "已归档" : "已取消归档");
  if (next) void select(null);
}

async function copySessionId() {
  const m = meta.value;
  const opts = live.value.configOptions ?? [];
  const modelOpt =
    opts.find((o) => o.category === "model") ??
    opts.find((o) => o.type === "select" && o.id.includes("model"));
  const modelVal = modelOpt?.currentValue != null ? String(modelOpt.currentValue) : "-";
  const info = [
    `会话 ID: ${m.id}`,
    `ACP Session: ${m.acpSessionId || "-"}`,
    `Agent: ${m.agentName} (${m.agentId})`,
    `模型: ${modelVal}`,
    `目录: ${m.cwd || "无"}`,
    `状态: ${live.value.status}`,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(info);
    message.success("已复制会话 ID 与诊断信息");
  } catch {
    message.error("复制失败");
  }
}

const menu = computed(() => ({
  items: [
    { key: "rename", label: "重命名" },
    { key: "pin", label: meta.value.pinned ? "取消置顶" : "置顶" },
    { key: "archive", label: archived.value ? "取消归档" : "归档对话" },
    { key: "new-same", label: meta.value.worktree ? "在源仓库新建对话" : meta.value.cwd ? "在同目录新建对话" : "新建同 Agent 对话" },
    ...(meta.value.cwd ? [{ key: "reveal", label: "在文件夹中显示" }] : []),
    ...(meta.value.worktree ? [{ key: "clean-worktree", label: "清理 Worktree" }] : []),
    { key: "copy-id", label: "复制会话 ID" },
    { type: "divider" as const },
    { key: "delete", label: "删除对话", danger: true },
  ],
  onClick: ({ key }: { key: string }) => {
    if (key === "rename") startEdit();
    if (key === "pin") void pin(meta.value.id, !meta.value.pinned);
    if (key === "archive") void toggleArchive();
    if (key === "new-same") void newSameDir();
    if (key === "reveal") void reveal();
    if (key === "clean-worktree") void openCleanWorktree();
    if (key === "copy-id") void copySessionId();
    if (key === "delete") void confirmDelete();
  },
}));

const deleting = ref(false);
const deleteBusy = ref(false);
const deleteWtStatus = ref<WorktreeStatus | null>(null);
const deleteRemoveWt = ref(false);
const deleteRemoveBranch = ref(false);

async function confirmDelete() {
  deleting.value = true;
  deleteWtStatus.value = null;
  deleteRemoveWt.value = Boolean(meta.value.worktree);
  deleteRemoveBranch.value = false;
  if (!meta.value.worktree) return;
  try {
    deleteWtStatus.value = await worktreeStatus(meta.value.id);
  } catch {
    deleteWtStatus.value = {
      exists: true,
      dirty: false,
      changedCount: 0,
      aheadCount: 0,
      branch: meta.value.worktreeBranch || "",
      baseBranch: meta.value.worktreeBase || "",
      changedFiles: [],
    };
  }
}

async function doDelete() {
  if (deleteBusy.value) return;
  deleteBusy.value = true;
  try {
    if (meta.value.worktree && deleteRemoveWt.value) {
      await removeWorktree(meta.value.id, true, deleteRemoveBranch.value);
    }
    deleting.value = false;
    await remove(meta.value.id);
    message.success("已删除");
    void select(null);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    deleteBusy.value = false;
  }
}

const wtPanelOpen = ref(false);
const wtPanelLoading = ref(false);
const wtPanelStatus = ref<WorktreeStatus | null>(null);

async function openWtPanel() {
  if (!meta.value.worktree) return;
  wtPanelOpen.value = true;
  wtPanelLoading.value = true;
  try {
    wtPanelStatus.value = await worktreeStatus(meta.value.id);
  } catch {
    wtPanelStatus.value = null;
  } finally {
    wtPanelLoading.value = false;
  }
}

async function copyWorktreeBranch() {
  const branch = wtPanelStatus.value?.branch || meta.value.worktreeBranch;
  if (!branch) return;
  try {
    await navigator.clipboard.writeText(branch);
    message.success(`已复制分支名：${branch}`);
  } catch {
    message.error("复制失败");
  }
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

async function revealSourceRepo() {
  const repo = meta.value.worktreeRepo;
  if (!repo) return;
  try {
    await api.reveal(repo);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

const cleaningWt = ref(false);
const cleanWtBusy = ref(false);
const cleanWtStatus = ref<WorktreeStatus | null>(null);
const cleanWtDeleteBranch = ref(false);

async function openCleanWorktree() {
  if (!meta.value.worktree) return;
  wtPanelOpen.value = false;
  cleaningWt.value = true;
  cleanWtStatus.value = null;
  cleanWtDeleteBranch.value = false;
  try {
    cleanWtStatus.value = await worktreeStatus(meta.value.id);
  } catch {
    cleanWtStatus.value = {
      exists: true,
      dirty: false,
      changedCount: 0,
      aheadCount: 0,
      branch: meta.value.worktreeBranch || "",
      baseBranch: meta.value.worktreeBase || "",
      changedFiles: [],
    };
  }
}

async function doCleanWorktree() {
  if (cleanWtBusy.value) return;
  cleanWtBusy.value = true;
  try {
    await removeWorktree(meta.value.id, true, cleanWtDeleteBranch.value);
    cleaningWt.value = false;
    message.success("已删除 Worktree");
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    cleanWtBusy.value = false;
  }
}

async function changeDir(path: string) {
  folderOpen.value = false;
  if (turns.value.length > 0) {
    message.info("工作目录在对话开始后不能改。新开一个对话放到这个目录吧。");
    return;
  }
  const agentId = meta.value.agentId;
  await remove(meta.value.id);
  await start(agentId, path, []);
}
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 w-full">
    <div class="flex-1 min-w-0 flex flex-col h-full min-h-0 relative">
      <header class="oc-chat-topbar flex-none h-titlebar flex items-center gap-[10px] pl-[18px] pr-3 bg-sidebar glass border-0 border-b border-solid border-line relative z-12">
        <div class="flex items-center gap-2 min-w-0 flex-1 overflow-hidden drag" :class="{ 'pl-[66px]': isMac && store.sidebarCollapsed }">
          <Tooltip v-if="store.sidebarCollapsed" :title="`展开侧栏 (${isMac ? '⌘' : 'Ctrl'} B)`" :mouse-enter-delay="0.4">
            <button class="icon-btn text-[14px] no-drag" @click="store.sidebarCollapsed = false">
              <MenuUnfoldOutlined />
            </button>
          </Tooltip>

          <div class="oc-title-line flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <input
              v-if="editing"
              id="title-edit"
              v-model="titleDraft"
              type="text"
              maxlength="60"
              placeholder="输入对话标题…"
              class="w-[260px] max-w-full h-[26px] px-2 rounded-[7px] border border-solid border-line-strong bg-surface-strong text-[13.5px] font-semibold tracking-[-0.015em] text-ink leading-5 outline-none transition-colors duration-140 focus:border-[color-mix(in_srgb,var(--ink)_36%,var(--border-strong))] focus-visible:shadow-none no-drag"
              @blur="commitTitle"
              @keydown="onTitleKeydown"
            />
            <button
              v-else
              class="border-0 bg-transparent p-0 text-[13.5px] font-semibold tracking-[-0.015em] text-ink text-left max-w-[340px] cursor-default leading-5 flex items-center flex-[0_1_auto] min-w-0 no-drag"
              :title="`${meta.title}（双击重命名）`"
              @dblclick="startEdit"
            >
              <span class="truncate">{{ meta.title || "新对话" }}</span>
            </button>

            <span class="oc-agent-badge inline-flex items-center gap-[5px] h-[22px] px-2 rounded-full bg-hover border border-solid border-line text-[11px] fw-520 text-ink-2 flex-none no-drag">
              <span
                class="w-[5px] h-[5px] rounded-full"
                :class="
                  live.status === 'ready'
                    ? 'bg-ok'
                    : live.status === 'running'
                      ? 'bg-ok animate-[oc-pulse_1.2s_ease-in-out_infinite]'
                      : live.status === 'connecting'
                        ? 'bg-warn animate-[oc-pulse_1.2s_ease-in-out_infinite]'
                        : live.status === 'error'
                          ? 'bg-err'
                          : 'bg-ink-3'
                "
              />
              <span>{{ meta.agentName }}</span>
            </span>

            <Tooltip v-if="!meta.worktree && meta.cwd" :title="`在文件夹中显示：${meta.cwd}`" :mouse-enter-delay="0.4">
              <button
                class="oc-cwd-chip inline-flex items-center gap-[5px] h-[22px] px-[7px] rounded-[6px] border-0 bg-transparent text-[11px] text-ink-3 max-w-[240px] min-w-0 flex-[0_1_auto] cursor-pointer font-mono transition-colors duration-140 hover:bg-hover hover:text-ink-2 no-drag"
                @click="reveal"
              >
                <FolderOpenOutlined />
                <span class="oc-cwd-text truncate">{{ shortCwd }}</span>
              </button>
            </Tooltip>
          </div>
        </div>

        <div class="flex items-center gap-[2px] flex-none no-drag">
          <Tooltip v-if="contextPct !== null" :title="usageLabel" :mouse-enter-delay="0.3">
            <div class="inline-flex items-center gap-[5px] h-7 pl-1 pr-2 rounded-[7px] cursor-default hover:bg-hover">
              <svg viewBox="0 0 20 20" class="w-[17px] h-[17px] -rotate-90">
                <circle cx="10" cy="10" r="8" class="fill-none stroke-line-strong" stroke-width="2.3" stroke-linecap="round" />
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  class="fill-none [stroke-dasharray:50.27] transition-[stroke-dashoffset] duration-400 ease-oc"
                  :class="contextPct > 80 ? 'stroke-warn' : 'stroke-ink-solid'"
                  stroke-width="2.3"
                  stroke-linecap="round"
                  :style="{ strokeDashoffset: 50.27 - (50.27 * contextPct) / 100 }"
                />
              </svg>
              <span class="text-[11px] font-mono" :class="contextPct > 80 ? 'text-warn' : 'text-ink-3'">{{ contextPct }}%</span>
            </div>
          </Tooltip>
          <Tooltip title="在同目录新建对话" :mouse-enter-delay="0.4">
            <button class="icon-btn text-[14px]" @click="newSameDir">
              <PlusOutlined />
            </button>
          </Tooltip>
          <Tooltip :title="meta.pinned ? '取消置顶' : '置顶'" :mouse-enter-delay="0.4">
            <button class="icon-btn text-[14px]" :class="{ 'text-ink': meta.pinned }" @click="pin(meta.id, !meta.pinned)">
              <PushpinFilled v-if="meta.pinned" />
              <PushpinOutlined v-else />
            </button>
          </Tooltip>
          <Tooltip :title="`工作区面板 (${isMac ? '⌘' : 'Ctrl'} J)`" :mouse-enter-delay="0.4">
            <button
              class="icon-btn text-[14px]"
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
          <Dropdown :menu="menu" :trigger="['click']" placement="bottomRight">
            <button class="icon-btn text-[14px]"><MoreOutlined /></button>
          </Dropdown>
          <WindowControls />
        </div>
      </header>

      <div
        v-if="live.status === 'error'"
        class="flex-none flex items-center gap-2 mt-2 mx-auto max-w-content w-[calc(100%-40px)] px-3 py-2 rounded-[9px] bg-err-soft text-err text-[12.5px]"
      >
        <WarningOutlined />
        <span class="flex-1 truncate">{{ live.error }}</span>
        <button
          class="border border-solid border-[color-mix(in_srgb,var(--err)_30%,transparent)] bg-transparent text-inherit rounded-[6px] px-2 py-[2px] text-[11.5px] cursor-pointer inline-flex items-center gap-1"
          @click="connect(meta.id)"
        >
          <ReloadOutlined /> 重试
        </button>
      </div>

      <div class="flex-1 min-h-0 relative flex flex-col">
        <div
          v-if="loadingHistory || (live.status === 'connecting' && !turns.length)"
          class="absolute inset-0 z-5 flex items-center justify-center px-5 pointer-events-none"
        >
          <div
            v-if="loadingHistory"
            class="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-surface glass-sm border border-solid border-line shadow-card text-[12.5px] text-ink-2 animate-oc-bubble-in"
          >
            <span class="w-3 h-3 rounded-full border-[1.5px] border-solid border-line-strong border-t-ink-solid animate-oc-spin" />
            <span>正在加载对话记录…</span>
          </div>
          <div
            v-else
            class="flex flex-col items-center gap-3 -mt-6 px-6 py-5 rounded-[16px] bg-surface glass-sm border border-solid border-line shadow-card animate-oc-bubble-in"
          >
            <div class="relative w-11 h-11 rounded-[13px] bg-modal border border-solid border-line-strong grid place-items-center text-ink">
              <ProviderIcon :id="meta.agentId" :name="meta.agentName" :size="22" />
              <span
                class="absolute -inset-[4px] rounded-[16px] border border-solid border-line-strong opacity-60 animate-[oc-pulse_1.6s_ease-in-out_infinite]"
                aria-hidden="true"
              />
            </div>
            <div class="flex flex-col items-center gap-1 text-center">
              <div class="flex items-center gap-2 text-[13.5px] fw-560 text-ink tracking-[-0.01em]">
                <span class="shimmer-text">正在与 {{ meta.agentName }} 建立连接</span>
              </div>
              <span v-if="shortCwd" class="text-[11.5px] text-ink-3 font-mono max-w-[260px] truncate">{{ shortCwd }}</span>
            </div>
          </div>
        </div>

        <MessageScroller
          ref="scroller"
          :key="meta.id"
          :follow="following"
          class="flex-1 min-h-0"
          :busy="running"
          :navigation="turns.length > 1 ? 'rail' : undefined"
          :items="scrollerItems"
          item-selector="[data-message-id]"
          :back-to-bottom="canScroll"
          @update:follow="onFollowUpdate"
          @rail-item-select="onRailItemSelect"
          @scroll="updateScrollable"
        >
          <div class="max-w-content mx-auto px-5 pt-4 pb-[6px] min-h-full flex flex-col">
          <div v-if="hiddenTurnCount > 0" class="flex items-center justify-center gap-2 pt-1 pb-[14px]">
            <button
              type="button"
              class="h-7 px-3 rounded-full border border-solid border-line-strong bg-surface text-ink-2 text-[12px] cursor-pointer transition-colors duration-140 hover:bg-surface-strong hover:text-ink"
              @click="loadOlderTurns()"
            >
              展开更早的 {{ Math.min(hiddenTurnCount, LOAD_MORE_STEP) }} 轮（共剩余 {{ hiddenTurnCount }} 轮）
            </button>
            <button
              v-if="hiddenTurnCount > LOAD_MORE_STEP"
              type="button"
              class="h-7 px-3 rounded-full border border-solid border-transparent bg-transparent text-ink-3 text-[12px] cursor-pointer transition-colors duration-140 hover:bg-hover hover:text-ink-2"
              @click="loadOlderTurns(hiddenTurnCount)"
            >
              全部展开
            </button>
          </div>
          <TurnView
            v-for="(turn, i) in visibleTurns"
            :key="turn.id"
            :data-message-id="turn.id"
            :turn="turn"
            :conversation-id="meta.id"
            :agent-id="meta.agentId"
            :agent-name="meta.agentName"
            :live="i === visibleTurns.length - 1 && (running || live.status === 'connecting')"
            :is-last="i === visibleTurns.length - 1"
            :can-retry="!running"
            @retry="retry"
          />
          <div class="h-4 flex-none" />
        </div>
      </MessageScroller>
      </div>

      <div class="flex-none relative px-5 pb-[14px] bg-transparent z-10">
        <div class="max-w-content mx-auto">
          <Composer
            v-model:value="draft"
            :conversation-id="meta.id"
            :live="live"
            :agent-id="meta.agentId"
            :agent-name="meta.agentName"
            :cwd="meta.cwd"
            :cwd-locked="turns.length > 0"
            :sending="running"
            :disabled="live.status === 'connecting'"
            :pending-perms="pendingPerms"
            :queued-messages="queuedMessages"
            lock-provider
            :placeholder="running ? '正在生成，输入内容可加入待发队列…' : `让 ${meta.agentName} 做点什么…`"
            @send="onSend"
            @enqueue="onEnqueue"
            @stop="cancel(meta.id)"
            @pick-model="onPickModel"
            @pick-mode="onPickMode"
            @respond-permission="onRespondPermission"
            @steer-queued="onSteer"
            @edit-queued="(qid) => popQueuedToDraft(meta.id, qid)"
            @remove-queued="(qid) => removeQueued(meta.id, qid)"
            @jump-turn="jumpToTurn"
            @cwd="folderOpen = true"
            @update:cwd="changeDir"
            @manage="store.settingsOpen = true"
          >
            <template #bar-extra>
              <Tooltip
                v-if="meta.worktree"
                :title="`隔离 Worktree：${meta.worktreeBranch || 'detached'}（点击查看改动或删除）`"
                :mouse-enter-delay="0.35"
              >
                <button
                  type="button"
                  class="inline-flex items-center gap-[5px] h-6 px-2 border border-solid rounded-[7px] bg-surface-strong text-ink fw-560 border-line-strong shadow-card text-[11.5px] cursor-pointer flex-[0_1_auto] min-w-0 max-w-[180px] transition-all duration-140 ease-oc hover:bg-active"
                  @click="openWtPanel"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.85"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="w-[12.5px] h-[12.5px] flex-none text-ok"
                  >
                    <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
                    <circle cx="13" cy="12" r="2" />
                    <path d="M18 19c-2.8 0-5-2.2-5-5v8" />
                    <circle cx="20" cy="19" r="2" />
                  </svg>
                  <span class="truncate">
                    Worktree<span v-if="meta.worktreeBranch" class="font-mono text-ink-2"> · {{ meta.worktreeBranch }}</span>
                  </span>
                </button>
              </Tooltip>
            </template>
          </Composer>
        </div>
      </div>

      <FolderPicker v-model:open="folderOpen" :path="meta.cwd" @pick="changeDir" />

      <Modal
        :open="deleting"
        title="删除这个对话？"
        :width="410"
        centered
        ok-text="删除"
        ok-type="primary"
        :ok-button-props="{ danger: true }"
        cancel-text="取消"
        :confirm-loading="deleteBusy"
        @ok="doDelete"
        @cancel="deleting = false"
      >
        <div class="flex flex-col gap-3 pt-1">
          <p class="text-[12.5px] text-ink-2 leading-[1.55] m-0">「{{ meta.title }}」的记录会从本机删除，无法恢复。</p>
          <div
            v-if="meta.worktree && deleteWtStatus?.exists"
            class="rounded-[10px] bg-surface-2 border border-solid border-line px-3 py-2.5 flex flex-col gap-2"
          >
            <Checkbox v-model:checked="deleteRemoveWt">
              <span class="text-[12.5px] text-ink">同时移除本地 Worktree 目录</span>
            </Checkbox>
            <div v-if="deleteRemoveWt && deleteWtStatus.dirty" class="flex items-start gap-1.5 text-[11.5px] text-ink-3 pl-6 leading-[1.45]">
              <WarningOutlined class="text-warn flex-none mt-[2px] text-[12px]" />
              <span>存在 {{ deleteWtStatus.changedCount }} 处未提交改动，移除目录后将无法恢复。</span>
            </div>
            <Checkbox v-if="deleteRemoveWt && meta.worktreeBranch" v-model:checked="deleteRemoveBranch" class="pl-6">
              <span class="text-[12px] text-ink-2">
                同时删除分支 <code class="font-mono text-ink">{{ meta.worktreeBranch }}</code>
              </span>
            </Checkbox>
          </div>
        </div>
      </Modal>

      <Modal
        :open="wtPanelOpen"
        title="Worktree 隔离工作区"
        :width="448"
        :footer="null"
        centered
        @cancel="wtPanelOpen = false"
      >
        <div class="flex flex-col gap-3 pt-1">
          <div class="flex flex-col gap-2 px-3.5 py-3 rounded-[10px] bg-surface-2 border border-solid border-line">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0 font-mono text-[12.5px]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.85"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-[13.5px] h-[13.5px] text-ink-3 flex-none"
                >
                  <line x1="6" x2="6" y1="3" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
                <span class="text-ink fw-560 truncate" :title="wtPanelStatus?.branch || meta.worktreeBranch || 'detached'">
                  {{ wtPanelStatus?.branch || meta.worktreeBranch || 'detached' }}
                </span>
                <Tooltip title="复制分支名" :mouse-enter-delay="0.3">
                  <button
                    v-if="wtPanelStatus?.branch || meta.worktreeBranch"
                    type="button"
                    class="inline-grid place-items-center w-5 h-5 border-0 rounded-[5px] bg-transparent text-ink-3 cursor-pointer flex-none transition-colors duration-120 hover:bg-hover hover:text-ink"
                    aria-label="复制分支名"
                    @click="copyWorktreeBranch"
                  >
                    <CopyOutlined class="text-[11px]" />
                  </button>
                </Tooltip>
              </div>
              <div class="flex items-center gap-1.5 flex-none text-[11px]">
                <span
                  v-if="wtPanelStatus?.dirty"
                  class="inline-flex items-center gap-1.5 px-2 py-[2px] rounded-full bg-surface-strong border border-solid border-line text-ink-2"
                >
                  <span class="w-[5px] h-[5px] rounded-full bg-warn flex-none" />
                  <span>未提交改动</span>
                </span>
                <span
                  v-else-if="wtPanelStatus && wtPanelStatus.aheadCount > 0"
                  class="inline-flex items-center px-2 py-[2px] rounded-full bg-surface-strong border border-solid border-line text-ink-2 font-mono"
                >
                  +{{ wtPanelStatus.aheadCount }} 提交
                </span>
                <span
                  v-else-if="wtPanelStatus"
                  class="inline-flex items-center px-2 py-[2px] rounded-full bg-surface-strong border border-solid border-line text-ink-3"
                >
                  工作区干净
                </span>
              </div>
            </div>
            <div class="flex items-center gap-1.5 text-[11px] text-ink-3 min-w-0">
              <FolderOpenOutlined class="flex-none text-[11.5px]" />
              <span class="font-mono truncate flex-1" :title="meta.cwd">{{ shortCwd }}</span>
              <Tooltip title="复制目录路径" :mouse-enter-delay="0.3">
                <button
                  type="button"
                  class="inline-grid place-items-center w-5 h-5 border-0 rounded-[5px] bg-transparent text-ink-3 cursor-pointer flex-none transition-colors duration-120 hover:bg-hover hover:text-ink"
                  aria-label="复制目录路径"
                  @click="copyWorktreePath(meta.cwd)"
                >
                  <CopyOutlined class="text-[11px]" />
                </button>
              </Tooltip>
              <span v-if="wtPanelStatus?.baseBranch || meta.worktreeBase" class="flex-none font-mono text-ink-3">
                · 基于 {{ wtPanelStatus?.baseBranch || meta.worktreeBase }}
              </span>
            </div>
          </div>

          <div v-if="wtPanelLoading" class="py-5 text-center text-[12px] text-ink-3">正在检查 Worktree 状态…</div>

          <template v-else-if="wtPanelStatus">
            <div v-if="wtPanelStatus.changedFiles?.length" class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between px-0.5 text-[11px] text-ink-3">
                <span>改动文件（{{ wtPanelStatus.changedFiles.length }}）</span>
                <span v-if="wtPanelStatus.aheadCount > 0" class="font-mono">含 {{ wtPanelStatus.aheadCount }} 个提交</span>
              </div>
              <div class="max-h-[180px] overflow-y-auto rounded-[10px] border border-solid border-line bg-surface-2 p-1.5 flex flex-col gap-0.5">
                <div
                  v-for="f in wtPanelStatus.changedFiles"
                  :key="f.path"
                  class="flex items-center gap-2 px-2 py-1 rounded-[6px] text-[11.5px] font-mono transition-colors duration-100 hover:bg-hover"
                >
                  <span class="w-[18px] h-[18px] rounded-[5px] bg-hover text-ink-2 text-[10.5px] fw-560 inline-grid place-items-center flex-none">
                    {{ f.status }}
                  </span>
                  <span class="text-ink truncate flex-1" :title="f.path">{{ f.path }}</span>
                </div>
              </div>
            </div>
            <div v-else class="py-4 text-center text-[12px] text-ink-3 rounded-[10px] border border-solid border-line bg-surface-2">
              当前 Worktree 暂无文件改动
            </div>
          </template>

          <div class="flex items-center justify-between gap-2 pt-2.5 border-0 border-t border-solid border-line">
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="h-7 px-2.5 rounded-[7px] border border-solid border-line bg-surface-2 text-ink-2 text-[12px] cursor-pointer transition-colors duration-120 hover:bg-hover hover:border-line-strong hover:text-ink"
                @click="reveal"
              >
                打开目录
              </button>
              <button
                v-if="meta.worktreeRepo"
                type="button"
                class="h-7 px-2.5 rounded-[7px] border border-solid border-line bg-surface-2 text-ink-2 text-[12px] cursor-pointer transition-colors duration-120 hover:bg-hover hover:border-line-strong hover:text-ink"
                @click="revealSourceRepo"
              >
                打开原仓库
              </button>
            </div>
            <button
              type="button"
              class="h-7 px-2.5 rounded-[7px] border border-solid border-transparent bg-transparent text-ink-2 text-[12px] fw-520 cursor-pointer transition-colors duration-120 hover:bg-err-soft hover:text-err"
              @click="openCleanWorktree"
            >
              删除 Worktree
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        :open="cleaningWt"
        title="删除 Worktree"
        :width="420"
        centered
        ok-text="删除"
        ok-type="primary"
        :ok-button-props="{ danger: true }"
        cancel-text="取消"
        :confirm-loading="cleanWtBusy"
        @ok="doCleanWorktree"
        @cancel="cleaningWt = false"
      >
        <div class="flex flex-col gap-3 pt-1">
          <p class="m-0 text-[12.5px] text-ink-2 leading-[1.55]">
            将永久移除该本地隔离目录。对话记录会保留并自动切回原仓库，不会影响原仓库中的文件。
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
                    @click="copyWorktreePath(meta.cwd)"
                  >
                    <CopyOutlined class="text-[11px]" />
                    <span>复制</span>
                  </button>
                </Tooltip>
              </div>
              <span class="font-mono text-[11.5px] text-ink break-all leading-[1.5]">{{ meta.cwd }}</span>
            </div>

            <div
              v-if="cleanWtStatus?.dirty"
              class="px-3 py-2.5 border-0 border-t border-solid border-line flex items-start gap-2"
            >
              <WarningOutlined class="flex-none text-warn mt-[2px] text-[13px]" />
              <div class="flex flex-col gap-0.5 leading-[1.45]">
                <span class="text-[12px] fw-540 text-ink">存在未提交的代码改动</span>
                <span class="text-[11.5px] text-ink-3">删除目录后这些改动将永久丢失，无法通过 Git 恢复。</span>
              </div>
            </div>

            <div
              v-if="meta.worktreeBranch"
              class="px-3 py-2.5 border-0 border-t border-solid border-line flex flex-col gap-1.5"
            >
              <Checkbox v-model:checked="cleanWtDeleteBranch">
                <span class="text-[12px] text-ink-2">
                  同时删除分支 <code class="font-mono text-ink">{{ meta.worktreeBranch }}</code>
                </span>
              </Checkbox>
              <div
                v-if="cleanWtStatus && cleanWtStatus.aheadCount > 0 && cleanWtDeleteBranch"
                class="pl-6 text-[11px] text-ink-3 leading-[1.45]"
              >
                该分支领先基准分支 {{ cleanWtStatus.aheadCount }} 个提交，删除分支后这些提交将一并移除。
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  </div>
</template>

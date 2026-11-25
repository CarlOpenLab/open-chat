<script setup lang="ts">
import {
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
import { Dropdown, Input, Modal, Tooltip, message } from "antdv-next";
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
  pin,
  popQueuedToDraft,
  remove,
  removeQueued,
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
} from "../store";
import { answerText, userText } from "../transcript";
import type { Block, PermissionOption } from "../types";
import Composer from "./Composer.vue";
import FolderPicker from "./FolderPicker.vue";
import ProviderIcon from "./ProviderIcon.vue";
import TurnView from "./TurnView.vue";
import WindowControls from "./WindowControls.vue";
import WorkspacePanel from "./WorkspacePanel.vue";

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
  void nextTick(() => document.getElementById("title-edit")?.focus());
}

async function commitTitle() {
  editing.value = false;
  const t = titleDraft.value.trim();
  if (t && t !== meta.value.title) await rename(meta.value.id, t);
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
  try {
    await api.reveal(meta.value.cwd);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

async function newSameDir() {
  try {
    await start(meta.value.agentId, meta.value.cwd, []);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
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
    `目录: ${m.cwd}`,
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
    { key: "new-same", label: "在同目录新建对话" },
    { key: "reveal", label: "在文件夹中显示" },
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
    if (key === "copy-id") void copySessionId();
    if (key === "delete") confirmDelete();
  },
}));

const deleting = ref(false);
function confirmDelete() {
  deleting.value = true;
}



async function doDelete() {
  deleting.value = false;
  await remove(meta.value.id);
  message.success("已删除");
  void select(null);
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
            <Input
              v-if="editing"
              id="title-edit"
              v-model:value="titleDraft"
              size="small"
              class="w-[280px] font-semibold no-drag"
              :maxlength="60"
              @blur="commitTitle"
              @press-enter="commitTitle"
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

            <Tooltip :title="`在文件夹中显示：${meta.cwd}`" :mouse-enter-delay="0.4">
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
                <span class="w-3 h-3 rounded-full border-[1.5px] border-solid border-line-strong border-t-ink-solid animate-oc-spin flex-none" />
                <span class="shimmer-text">正在与 {{ meta.agentName }} 建立连接</span>
              </div>
              <span class="text-[11.5px] text-ink-3 font-mono max-w-[260px] truncate">{{ shortCwd }}</span>
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
            @manage="store.settingsOpen = true"
          />
        </div>
      </div>

      <FolderPicker v-model:open="folderOpen" :path="meta.cwd" @pick="changeDir" />

      <Modal
        :open="deleting"
        title="删除这个对话？"
        :width="380"
        ok-text="删除"
        ok-type="danger"
        cancel-text="取消"
        @ok="doDelete"
        @cancel="deleting = false"
      >
        <p class="text-ink-2 m-0">「{{ meta.title }}」的记录会从本机删除，无法恢复。</p>
      </Modal>
    </div>
    <WorkspacePanel
      :open="store.workspaceOpen"
      :cwd="meta.cwd"
      @close="store.workspaceOpen = false"
    />
  </div>
</template>

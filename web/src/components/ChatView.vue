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

const running = computed(() => live.value.status === "running");
const turns = computed(() => transcript.value?.turns ?? []);
const queuedMessages = computed(() => store.queues[meta.value.id] ?? []);

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

function jumpToTurn(turnId: string) {
  scrollToTurnStart(turnId, true);
}

function onRailItemSelect(id: string | number) {
  // Run after MessageScroller's synchronous handleRailItemClick (which centers the full
  // turn or jumps to the bottom on the last item) so we always land at the message start.
  void nextTick().then(() => {
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
    await nextTick();
    scrollToBottom(false);
    updateScrollable();
    if (live.value.status === "idle") void connect(id);
  },
);

onMounted(async () => {
  await nextTick();
  scrollToBottom();
  updateScrollable();
  window.addEventListener("resize", updateScrollable);
  if (live.value.status === "idle") void connect(meta.value.id);
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

const menu = computed(() => ({
  items: [
    { key: "rename", label: "重命名" },
    { key: "pin", label: meta.value.pinned ? "取消置顶" : "置顶" },
    { key: "archive", label: archived.value ? "取消归档" : "归档对话" },
    { key: "new-same", label: "在同目录新建对话" },
    { key: "reveal", label: "在文件夹中显示" },
    { type: "divider" as const },
    { key: "delete", label: "删除对话", danger: true },
  ],
  onClick: ({ key }: { key: string }) => {
    if (key === "rename") startEdit();
    if (key === "pin") void pin(meta.value.id, !meta.value.pinned);
    if (key === "archive") void toggleArchive();
    if (key === "new-same") void newSameDir();
    if (key === "reveal") void reveal();
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
  <div class="chat-layout">
    <div class="chat">
    <header class="topbar">
      <div class="left drag" :class="{ mac: isMac && store.sidebarCollapsed }">
        <Tooltip v-if="store.sidebarCollapsed" :title="`展开侧栏 (${isMac ? '⌘' : 'Ctrl'} B)`" :mouse-enter-delay="0.4">
          <button class="icon-btn no-drag" @click="store.sidebarCollapsed = false">
            <MenuUnfoldOutlined />
          </button>
        </Tooltip>

        <div class="title-line">
          <Input
            v-if="editing"
            id="title-edit"
            v-model:value="titleDraft"
            size="small"
            class="title-input no-drag"
            :maxlength="60"
            @blur="commitTitle"
            @press-enter="commitTitle"
          />
          <button v-else class="title no-drag" :title="`${meta.title}（双击重命名）`" @dblclick="startEdit">
            <span class="title-text">{{ meta.title || "新对话" }}</span>
          </button>

          <span class="agent-badge no-drag">
            <span class="status-dot" :class="live.status" />
            <span>{{ meta.agentName }}</span>
          </span>

          <Tooltip :title="`在文件夹中显示：${meta.cwd}`" :mouse-enter-delay="0.4">
            <button class="cwd-chip mono no-drag" @click="reveal">
              <FolderOpenOutlined />
              <span class="cwd-text">{{ shortCwd }}</span>
            </button>
          </Tooltip>
        </div>
      </div>

      <div class="right no-drag">
        <Tooltip v-if="contextPct !== null" :title="usageLabel" :mouse-enter-delay="0.3">
          <div class="ctx" :class="{ high: contextPct > 80 }">
            <svg viewBox="0 0 20 20" class="ring">
              <circle cx="10" cy="10" r="8" class="track" />
              <circle
                cx="10"
                cy="10"
                r="8"
                class="fill"
                :style="{ strokeDashoffset: 50.27 - (50.27 * contextPct) / 100 }"
              />
            </svg>
            <span class="ctx-label">{{ contextPct }}%</span>
          </div>
        </Tooltip>
        <Tooltip title="在同目录新建对话" :mouse-enter-delay="0.4">
          <button class="icon-btn" @click="newSameDir">
            <PlusOutlined />
          </button>
        </Tooltip>
        <Tooltip :title="meta.pinned ? '取消置顶' : '置顶'" :mouse-enter-delay="0.4">
          <button class="icon-btn" :class="{ on: meta.pinned }" @click="pin(meta.id, !meta.pinned)">
            <PushpinFilled v-if="meta.pinned" />
            <PushpinOutlined v-else />
          </button>
        </Tooltip>
        <Tooltip :title="`工作区面板 (${isMac ? '⌘' : 'Ctrl'} J)`" :mouse-enter-delay="0.4">
          <button
            class="icon-btn"
            :class="{ on: store.workspaceOpen }"
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
              class="panel-ic"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M15 3v18" />
            </svg>
          </button>
        </Tooltip>
        <Dropdown :menu="menu" :trigger="['click']" placement="bottomRight">
          <button class="icon-btn"><MoreOutlined /></button>
        </Dropdown>
        <WindowControls />
      </div>
    </header>

    <div v-if="live.status === 'error'" class="banner">
      <WarningOutlined />
      <span class="msg">{{ live.error }}</span>
      <button class="retry" @click="connect(meta.id)"><ReloadOutlined /> 重试</button>
    </div>

    <MessageScroller
      ref="scroller"
      :key="meta.id"
      :follow="following"
      class="scroll"
      :busy="running"
      :navigation="turns.length > 1 ? 'rail' : undefined"
      :items="scrollerItems"
      item-selector="[data-message-id]"
      :back-to-bottom="canScroll"
      @update:follow="onFollowUpdate"
      @rail-item-select="onRailItemSelect"
      @scroll="updateScrollable"
    >
      <div class="inner">
        <div v-if="live.status === 'connecting' && !turns.length" class="hint">
          <span class="spinner" />
          <span>正在和 {{ meta.agentName }} 建立连接…</span>
        </div>
        <TurnView
          v-for="(turn, i) in turns"
          :key="turn.id"
          :data-message-id="turn.id"
          :turn="turn"
          :conversation-id="meta.id"
          :agent-id="meta.agentId"
          :agent-name="meta.agentName"
          :live="i === turns.length - 1 && (running || live.status === 'connecting')"
          :is-last="i === turns.length - 1"
          :can-retry="!running"
          @retry="retry"
        />
        <div class="tail" />
      </div>
    </MessageScroller>

    <div class="dock">
      <div class="dock-inner">

        <Composer
          v-model:value="draft"
          :conversation-id="meta.id"
          :live="live"
          :agent-id="meta.agentId"
          :agent-name="meta.agentName"
          :cwd="meta.cwd"
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
      <p class="muted" style="margin: 0">「{{ meta.title }}」的记录会从本机删除，无法恢复。</p>
    </Modal>
    </div>
    <WorkspacePanel
      :open="store.workspaceOpen"
      :cwd="meta.cwd"
      @close="store.workspaceOpen = false"
    />
  </div>
</template>

<style scoped>
.chat-layout {
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
}
.chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
}
.panel-ic {
  width: 15px;
  height: 15px;
  display: block;
}

.topbar {
  flex: none;
  height: var(--titlebar);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 18px;
  background: var(--bg-sidebar);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--border);
  position: relative;
  z-index: 12;
  container-type: inline-size;
}

.left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.left.mac {
  padding-left: 66px;
}

.title {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--text);
  text-align: left;
  max-width: 340px;
  cursor: default;
  line-height: 20px;
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 60px;
}
.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title-input {
  width: 280px;
  font-weight: 600;
}

.agent-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--hover);
  border: 1px solid var(--border);
  font-size: 11px;
  font-weight: 520;
  color: var(--text-2);
  flex: none;
}
.status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-3);
}
.status-dot.ready {
  background: var(--ok);
}
.status-dot.running {
  background: var(--ok);
  animation: oc-pulse 1.2s ease-in-out infinite;
}
.status-dot.connecting {
  background: var(--warn);
  animation: oc-pulse 1.2s ease-in-out infinite;
}
.status-dot.error {
  background: var(--err);
}

.cwd-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 7px;
  border-radius: 6px;
  border: none;
  background: transparent;
  font-size: 11px;
  color: var(--text-3);
  max-width: 240px;
  min-width: 0;
  flex: 0 1 auto;
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
}
.cwd-chip:hover {
  background: var(--hover);
  color: var(--text-2);
}
.cwd-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@container (max-width: 660px) {
  .cwd-text {
    display: none;
  }
  .cwd-chip {
    padding: 0 5px;
  }
  .title-line {
    gap: 6px;
  }
}

@container (max-width: 520px) {
  .cwd-chip {
    display: none;
  }
  .agent-badge {
    padding: 0 6px;
  }
}

.right {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
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
  font-size: 14px;
  transition: background 0.14s, color 0.14s;
}
.icon-btn:hover {
  background: var(--hover);
  color: var(--text);
}
.icon-btn.on {
  color: var(--text);
}

.ctx {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px 0 4px;
  border-radius: 7px;
  cursor: default;
}
.ctx:hover {
  background: var(--hover);
}
.ring {
  width: 17px;
  height: 17px;
  transform: rotate(-90deg);
}
.ring circle {
  fill: none;
  stroke-width: 2.3;
  stroke-linecap: round;
}
.ring .track {
  stroke: var(--border-strong);
}
.ring .fill {
  stroke: var(--ink);
  stroke-dasharray: 50.27;
  transition: stroke-dashoffset 0.4s var(--ease);
}
.ctx.high .ring .fill {
  stroke: var(--warn);
}
.ctx.high .ctx-label {
  color: var(--warn);
}
.ctx-label {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--text-3);
}

.banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px auto 0;
  max-width: var(--content-width);
  width: calc(100% - 40px);
  padding: 8px 12px;
  border-radius: 9px;
  background: var(--err-soft);
  color: var(--err);
  font-size: 12.5px;
}
.banner .msg {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.banner .retry {
  border: 1px solid color-mix(in srgb, var(--err) 30%, transparent);
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11.5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.scroll {
  flex: 1;
  min-height: 0;
}
.inner {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 16px 20px 6px;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.tail {
  height: 16px;
  flex: none;
}

.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  font-size: 12.5px;
  color: var(--text-3);
  padding: 36px 0;
}
.spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  border-top-color: var(--ink);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.jump {
  position: absolute;
  left: 50%;
  bottom: 132px;
  transform: translateX(-50%);
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-2);
  box-shadow: var(--shadow-pop);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  z-index: 14;
  font-size: 11.5px;
  transition: color 0.14s, transform 0.14s var(--ease);
}
.jump:hover {
  color: var(--text);
  transform: translateX(-50%) translateY(-1px);
}

.dock {
  flex: none;
  position: relative;
  padding: 0 20px 14px;
  background: transparent;
  z-index: 10;
}
.dock-inner {
  max-width: var(--content-width);
  margin: 0 auto;
}


.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s var(--ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

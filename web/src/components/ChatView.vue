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
import type { Block } from "../types";
import Composer from "./Composer.vue";
import FolderPicker from "./FolderPicker.vue";
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

const agentInfo = computed(() => store.agents.find((a) => a.id === meta.value.agentId));
const running = computed(() => live.value.status === "running");
const turns = computed(() => transcript.value?.turns ?? []);
const queuedMessages = computed(() => store.queues[meta.value.id] ?? []);

function queuePreview(blocks: Block[]): string {
  const text = userText(blocks).replace(/\s+/g, " ").trim();
  const imgs = blocks.filter((b) => b.type === "image").length;
  const files = blocks.filter((b) => b.type === "resource_link").length;
  const attach: string[] = [];
  if (imgs) attach.push(`${imgs} 张图片`);
  if (files) attach.push(`${files} 个文件`);
  if (text && attach.length) return `${text} · ${attach.join("、")}`;
  return text || attach.join("、") || "待发送消息";
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

// Deck-stack cards peeking above Composer (Mode 3 from sender-stacked-studio)
const pendingPerms = computed(() => {
  const list: {
    turnId: string;
    requestId: string;
    title: string;
    allowOnceId?: string;
    rejectId?: string;
  }[] = [];
  for (const t of turns.value) {
    for (const seg of t.segments) {
      if (seg.kind === "permission" && !seg.resolved) {
        const allow = seg.options.find((o) => o.kind === "allow_once") ?? seg.options.find((o) => o.kind.startsWith("allow"));
        const reject = seg.options.find((o) => !o.kind.startsWith("allow"));
        list.push({
          turnId: t.id,
          requestId: seg.requestId,
          title: seg.toolCall?.title || seg.toolCall?.kind || "需要你的确认",
          allowOnceId: allow?.optionId,
          rejectId: reject?.optionId,
        });
      }
    }
  }
  return list;
});

const activePlanSummary = computed(() => {
  for (let i = turns.value.length - 1; i >= 0; i--) {
    const t = turns.value[i];
    for (let j = t.segments.length - 1; j >= 0; j--) {
      const seg = t.segments[j];
      if (seg.kind === "plan" && seg.entries.length > 0) {
        const done = seg.entries.filter((e) => e.status === "completed").length;
        if (done === seg.entries.length && !running.value) return null;
        const cur = seg.entries.find((e) => e.status === "in_progress") ?? seg.entries.find((e) => e.status !== "completed");
        return {
          turnId: t.id,
          done,
          total: seg.entries.length,
          current: cur?.content ?? "全部步骤已完成",
        };
      }
    }
  }
  return null;
});

function quickRespond(requestId: string, optionId?: string) {
  if (!optionId) return;
  void respond(meta.value.id, requestId, optionId);
}

function jumpToTurn(turnId: string) {
  scroller.value?.scrollToItem(turnId, { behavior: "smooth" });
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

function toggleArchive() {
  const next = !archived.value;
  setArchived(meta.value.id, next);
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
    ...(agentInfo.value?.homepage ? [{ key: "home", label: "agent 主页" }] : []),
    { type: "divider" as const },
    { key: "delete", label: "删除对话", danger: true },
  ],
  onClick: ({ key }: { key: string }) => {
    if (key === "rename") startEdit();
    if (key === "pin") void pin(meta.value.id, !meta.value.pinned);
    if (key === "archive") toggleArchive();
    if (key === "new-same") void newSameDir();
    if (key === "reveal") void reveal();
    if (key === "home") window.open(agentInfo.value!.homepage, "_blank");
    if (key === "delete") confirmDelete();
  },
}));

const deleting = ref(false);
function confirmDelete() {
  deleting.value = true;
}

const stallHint = ref(false);
let stallTimer: number | undefined;
function armStallWatch() {
  window.clearTimeout(stallTimer);
  stallHint.value = false;
  if (!running.value) return;
  stallTimer = window.setTimeout(() => (stallHint.value = true), 90_000);
}
watch(
  () => [meta.value.id, running.value, transcript.value?.version],
  () => armStallWatch(),
);
onBeforeUnmount(() => window.clearTimeout(stallTimer));

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
  <div class="chat">
    <header class="topbar">
      <div class="left drag">
        <Tooltip v-if="store.sidebarCollapsed" :title="`展开侧栏 (${isMac ? '⌘' : 'Ctrl'} B)`" :mouse-enter-delay="0.4">
          <button class="icon-btn no-drag" :class="{ mac: isMac && store.sidebarCollapsed }" @click="store.sidebarCollapsed = false">
            <MenuUnfoldOutlined />
          </button>
        </Tooltip>

        <div class="title-line" :class="{ mac: isMac && store.sidebarCollapsed }">
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
      v-model:follow="following"
      class="scroll"
      :busy="running"
      :navigation="turns.length > 1 ? 'rail' : undefined"
      :items="scrollerItems"
      item-selector="[data-message-id]"
      :back-to-bottom="canScroll"
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
        <div v-if="stallHint && running" class="stall">
          <WarningOutlined />
          <span>{{ meta.agentName }} 已经安静一分钟了，可能卡住了。可以停止后重试。</span>
          <button class="stall-stop" @click="cancel(meta.id)">停止</button>
        </div>

        <!-- Top deck-stack backdrop cards above Composer for queued messages, pending permissions & active plan -->
        <div v-if="queuedMessages.length || pendingPerms.length || activePlanSummary" class="deck-stack">
          <button
            v-if="activePlanSummary"
            type="button"
            class="deck-card"
            :class="pendingPerms.length || queuedMessages.length ? 'deck-back' : 'deck-front'"
            @click="jumpToTurn(activePlanSummary.turnId)"
          >
            <span class="deck-left">
              <span class="deck-dot plan" />
              <span class="deck-label">执行计划 {{ activePlanSummary.done }}/{{ activePlanSummary.total }}</span>
              <span class="deck-text">{{ activePlanSummary.current }}</span>
            </span>
            <span class="deck-hint">查看 ▾</span>
          </button>

          <div v-if="pendingPerms.length" class="deck-card deck-perm" :class="queuedMessages.length ? 'deck-back' : 'deck-front'">
            <button type="button" class="deck-left deck-jump" @click="jumpToTurn(pendingPerms[0].turnId)">
              <span class="deck-dot warn" />
              <span class="deck-label">待确认{{ pendingPerms.length > 1 ? ` (${pendingPerms.length})` : '' }}</span>
              <span class="deck-text">{{ pendingPerms[0].title }}</span>
            </button>
            <div class="deck-acts">
              <button
                v-if="pendingPerms[0].rejectId"
                type="button"
                class="deck-act"
                @click.stop="quickRespond(pendingPerms[0].requestId, pendingPerms[0].rejectId)"
              >
                拒绝
              </button>
              <button
                v-if="pendingPerms[0].allowOnceId"
                type="button"
                class="deck-act primary"
                @click.stop="quickRespond(pendingPerms[0].requestId, pendingPerms[0].allowOnceId)"
              >
                允许
              </button>
            </div>
          </div>

          <div v-if="queuedMessages.length" class="deck-card deck-front deck-queue">
            <div class="queue-list">
              <div v-for="(item, qi) in queuedMessages" :key="item.id" class="queue-row">
                <span class="queue-tag mono">{{ qi + 1 }}</span>
                <span class="queue-text" :title="queuePreview(item.blocks)">{{ queuePreview(item.blocks) }}</span>
                <div class="queue-acts">
                  <Tooltip title="立即打断当前输出并发送" :mouse-enter-delay="0.25">
                    <button type="button" class="queue-ic steer" aria-label="立即发送" @click.stop="onSteer(item.id)">
                      <!-- Lucide CornerDownLeft (Return key) -->
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 10 4 15 9 20" />
                        <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                      </svg>
                    </button>
                  </Tooltip>
                  <Tooltip title="放回输入框编辑" :mouse-enter-delay="0.25">
                    <button type="button" class="queue-ic" aria-label="编辑" @click.stop="popQueuedToDraft(meta.id, item.id)">
                      <!-- Lucide Pencil -->
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                      </svg>
                    </button>
                  </Tooltip>
                  <Tooltip title="移出队列" :mouse-enter-delay="0.25">
                    <button type="button" class="queue-ic danger" aria-label="删除" @click.stop="removeQueued(meta.id, item.id)">
                      <!-- Lucide X -->
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Composer
          v-model:value="draft"
          :conversation-id="meta.id"
          :live="live"
          :agent-id="meta.agentId"
          :agent-name="meta.agentName"
          :cwd="meta.cwd"
          :sending="running"
          :disabled="live.status === 'connecting'"
          lock-provider
          :placeholder="running ? '正在生成，输入内容可加入待发队列…' : `让 ${meta.agentName} 做点什么…`"
          @send="onSend"
          @enqueue="onEnqueue"
          @stop="cancel(meta.id)"
          @pick-model="onPickModel"
          @pick-mode="onPickMode"
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
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
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
.mac {
  padding-left: 74px;
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
  min-width: 0;
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

/* Stacked deck cards peeking above Composer */
.deck-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: -10px;
  position: relative;
  z-index: 1;
}
.deck-card {
  width: 100%;
  height: 44px;
  padding: 0 16px 8px;
  border: 1px solid var(--border-strong);
  border-bottom: none;
  border-radius: 16px 16px 0 0;
  background: var(--surface-2);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: 0 -4px 16px rgba(15, 23, 42, 0.04);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
  transition: transform 0.25s var(--ease), background 0.16s ease;
}
.deck-front {
  width: 97%;
  z-index: 2;
  background: var(--surface);
}
.deck-back {
  width: 93%;
  margin-bottom: -14px;
  z-index: 1;
  opacity: 0.92;
}
.deck-stack:hover .deck-front {
  transform: translateY(-2px);
}
.deck-stack:hover .deck-back {
  transform: translateY(-5px);
}
.deck-perm {
  border-color: color-mix(in srgb, var(--warn) 36%, var(--border-strong));
  background: color-mix(in srgb, var(--warn-soft) 45%, var(--surface));
}
.deck-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
}
.deck-jump {
  border: none;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.deck-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
.deck-dot.warn {
  background: var(--warn);
  animation: oc-pulse 1.4s ease-in-out infinite;
}
.deck-dot.plan {
  background: var(--ok);
}
.deck-label {
  font-weight: 560;
  color: var(--text);
  flex: none;
}
.deck-text {
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.deck-hint {
  font-size: 11.5px;
  color: var(--text-3);
  flex: none;
}
.deck-acts {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
}
.deck-act {
  height: 22px;
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--surface-strong);
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 520;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.deck-act:hover {
  color: var(--text);
  background: var(--hover);
}
.deck-act.primary {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--ink-inv);
}
.deck-act.primary:hover {
  opacity: 0.9;
}

.deck-queue {
  height: auto;
  padding: 7px 12px 15px;
  cursor: default;
}
.queue-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 112px;
  overflow-y: auto;
}
.queue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  padding: 2px 4px 2px 6px;
  border-radius: 7px;
  transition: background 0.14s var(--ease);
}
.queue-row:hover {
  background: var(--hover);
}
.queue-tag {
  width: 17px;
  height: 17px;
  border-radius: 5px;
  background: var(--hover);
  border: 1px solid var(--border);
  color: var(--text-3);
  font-size: 10.5px;
  display: inline-grid;
  place-items: center;
  flex: none;
}
.queue-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.queue-acts {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.queue-ic {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
}
.queue-ic svg {
  width: 12.5px;
  height: 12.5px;
}
.queue-ic:hover {
  background: var(--active);
  color: var(--text);
}
.queue-ic.steer {
  color: var(--text-2);
}
.queue-ic.steer:hover {
  background: var(--ink);
  color: var(--ink-inv);
}
.queue-ic.danger:hover {
  background: var(--err-soft);
  color: var(--err);
}

.stall {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--warn);
  background: var(--warn-soft);
  border: 1px solid color-mix(in srgb, var(--warn) 25%, transparent);
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
}
.stall span {
  flex: 1;
}
.stall-stop {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
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

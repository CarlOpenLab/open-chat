<script setup lang="ts">
import {
  ArrowDownOutlined,
  CheckOutlined,
  MoreOutlined,
  MenuUnfoldOutlined,
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  WarningOutlined,
} from "@antdv-next/icons";
import { Dropdown, Input, Modal, Tooltip, message } from "antdv-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "../api";
import {
  activeLive,
  activeMeta,
  activeTranscript,
  cancel,
  connect,
  isMac,
  pin,
  remove,
  rename,
  select,
  send,
  setConfig,
  setMode,
  start,
  store,
} from "../store";
import type { Block } from "../types";
import Composer from "./Composer.vue";
import FolderPicker from "./FolderPicker.vue";
import TurnView from "./TurnView.vue";
import WindowControls from "./WindowControls.vue";

const meta = computed(() => activeMeta.value!);
const live = computed(() => activeLive.value);
const transcript = computed(() => activeTranscript.value);

const scroller = ref<HTMLDivElement | null>(null);
const atBottom = ref(true);
const editing = ref(false);
const titleDraft = ref("");
const folderOpen = ref(false);

const agentInfo = computed(() => store.agents.find((a) => a.id === meta.value.agentId));
const running = computed(() => live.value.status === "running");
const turns = computed(() => transcript.value?.turns ?? []);

const draft = computed({
  get: () => store.drafts[meta.value.id] ?? "",
  set: (v: string) => (store.drafts[meta.value.id] = v),
});

function nearBottom() {
  const el = scroller.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function onScroll() {
  atBottom.value = nearBottom();
}

function scrollToBottom(smooth = false) {
  const el = scroller.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  atBottom.value = true;
}

watch(
  () => transcript.value?.version,
  async () => {
    if (!atBottom.value) return;
    await nextTick();
    scrollToBottom();
  },
);

watch(
  () => meta.value.id,
  async () => {
    await nextTick();
    scrollToBottom();
  },
);

onMounted(async () => {
  await nextTick();
  scrollToBottom();
  if (live.value.status === "idle") void connect(meta.value.id);
});

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

function humanStatus() {
  switch (live.value.status) {
    case "connecting":
      return "连接中";
    case "running":
      return "正在工作";
    case "error":
      return "连接失败";
    default:
      return "";
  }
}

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

const menu = computed(() => ({
  items: [
    { key: "rename", label: "重命名", icon: () => null },
    { key: "pin", label: meta.value.pinned ? "取消置顶" : "置顶" },
    { key: "reveal", label: "在文件夹中显示" },
    ...(agentInfo.value?.homepage ? [{ key: "home", label: "agent 主页" }] : []),
    { type: "divider" as const },
    { key: "delete", label: "删除对话", danger: true },
  ],
  onClick: ({ key }: { key: string }) => {
    if (key === "rename") startEdit();
    if (key === "pin") void pin(meta.value.id, !meta.value.pinned);
    if (key === "reveal") void reveal();
    if (key === "home") window.open(agentInfo.value!.homepage, "_blank");
    if (key === "delete") confirmDelete();
  },
}));

const deleting = ref(false);
async function confirmDelete() {
  deleting.value = true;
}

/* A turn with no events for a minute usually means the agent is stuck: say so
   quietly, and leave stopping to the user. */
const stallHint = ref(false);
let stallTimer: number | undefined;
function armStallWatch() {
  window.clearTimeout(stallTimer);
  stallHint.value = false;
  if (!running.value) return;
  stallTimer = window.setTimeout(() => (stallHint.value = true), 90_000);
}
watch(
  () => [running.value, transcript.value?.version],
  () => armStallWatch(),
);
onBeforeUnmount(() => window.clearTimeout(stallTimer));

async function doDelete() {
  deleting.value = false;
  await remove(meta.value.id);
  message.success("已删除");
  void select(null);
}

/** A conversation keeps its working directory; an empty one may move. */
async function changeDir(path: string) {
  folderOpen.value = false;
  if (turns.value.length > 0) {
    message.info("工作目录在对话开始后不能改。新开一个对话放到这个目录吧。");
    return;
  }
  const agentId = meta.value.agentId;
  await remove(meta.value.id);
  const m = await start(agentId, path, []);
  void m;
}
</script>

<template>
  <div class="chat">
    <header class="topbar">
      <div class="left drag">
        <Tooltip v-if="store.sidebarCollapsed" title="展开侧栏" :mouse-enter-delay="0.4">
          <button class="icon-btn no-drag" :class="{ mac: isMac && store.sidebarCollapsed }" @click="store.sidebarCollapsed = false">
            <MenuUnfoldOutlined />
          </button>
        </Tooltip>
        <div class="titles" :class="{ mac: isMac && store.sidebarCollapsed }">
          <Input
            v-if="editing"
            id="title-edit"
            v-model:value="titleDraft"
            size="small"
            class="title-input"
            :maxlength="60"
            @blur="commitTitle"
            @press-enter="commitTitle"
          />
          <button v-else class="title" :title="meta.title" @dblclick="startEdit">
            {{ meta.title || "新对话" }}
            <span v-if="running" class="pulse-dot" />
          </button>
          <div class="sub">
            <span class="agent">{{ meta.agentName }}</span>
            <span class="sep">·</span>
            <button class="cwd mono" :title="meta.cwd" @click="reveal">{{ meta.cwd }}</button>
            <span v-if="humanStatus()" class="sep">·</span>
            <span v-if="humanStatus()" class="state" :class="live.status">{{ humanStatus() }}</span>
          </div>
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

    <div ref="scroller" class="scroll" @scroll="onScroll">
      <div class="inner">
        <div v-if="live.status === 'connecting' && !turns.length" class="hint">
          <span class="spinner" />
          <span>正在和 {{ meta.agentName }} 建立连接…</span>
        </div>
        <TurnView
          v-for="(turn, i) in turns"
          :key="turn.id"
          :turn="turn"
          :conversation-id="meta.id"
          :live="i === turns.length - 1 && (running || live.status === 'connecting')"
          :can-retry="!running"
          @retry="retry"
        />
        <div class="tail" />
      </div>
    </div>

    <Transition name="fade">
      <button v-if="!atBottom" class="jump" @click="scrollToBottom(true)"><ArrowDownOutlined /></button>
    </Transition>

    <div class="dock">
      <div class="dock-inner">
        <div v-if="stallHint && running" class="stall">
          <WarningOutlined />
          <span>{{ meta.agentName }} 已经安静一分钟了，可能卡住了。可以停止后重试。</span>
          <button class="stall-stop" @click="cancel(meta.id)">停止</button>
        </div>
        <Composer
          v-model:value="draft"
          :live="live"
          :agent-name="meta.agentName"
          :cwd="meta.cwd"
          :sending="running"
          :disabled="live.status === 'connecting'"
          :placeholder="running ? '正在生成，可以先想下一步…' : `让 ${meta.agentName} 做点什么…`"
          @send="onSend"
          @stop="cancel(meta.id)"
          @pick-model="onPickModel"
          @pick-mode="onPickMode"
          @cwd="folderOpen = true"
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
  padding: 0 12px 0 14px;
  border-bottom: 1px solid transparent;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: saturate(180%) blur(18px);
  position: relative;
  z-index: 12;
}
.topbar::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--border);
  opacity: 0.7;
}

.left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.titles {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0;
  padding: 6px 0;
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
  letter-spacing: -0.01em;
  color: var(--text);
  text-align: left;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
  line-height: 19px;
  display: flex;
  align-items: center;
  gap: 7px;
}
.title-input {
  width: 320px;
  font-weight: 600;
}
.sub {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 15px;
  min-width: 0;
}
.agent {
  color: var(--text-2);
}
.sep {
  opacity: 0.6;
}
.cwd {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 11px;
  color: var(--text-3);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  cursor: pointer;
}
.cwd:hover {
  color: var(--text-2);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.state.running {
  color: var(--accent-text);
}
.state.error {
  color: var(--err);
}

.pulse-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  animation: oc-pulse 1.3s ease-in-out infinite;
  flex: none;
}

.right {
  display: flex;
  align-items: center;
  gap: 2px;
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
  color: var(--accent-text);
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
  width: 18px;
  height: 18px;
  transform: rotate(-90deg);
}
.ring circle {
  fill: none;
  stroke-width: 2.4;
  stroke-linecap: round;
}
.ring .track {
  stroke: var(--border-strong);
}
.ring .fill {
  stroke: var(--accent);
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
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: auto;
}
.inner {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 20px 28px 8px;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.tail {
  height: 28px;
  flex: none;
}

.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  font-size: 12.5px;
  color: var(--text-3);
  padding: 30px 0;
}
.spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  border-top-color: var(--accent);
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
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  box-shadow: var(--shadow-pop);
  cursor: pointer;
  display: grid;
  place-items: center;
  z-index: 14;
  font-size: 12px;
}
.jump:hover {
  color: var(--text);
}

.dock {
  flex: none;
  position: relative;
  padding: 0 28px 18px;
  background: linear-gradient(to top, var(--bg) 62%, transparent);
  z-index: 10;
}
.dock-inner {
  max-width: var(--content-width);
  margin: 0 auto;
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
  transition: opacity 0.18s var(--ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

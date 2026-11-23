<script setup lang="ts">
import { Actions, ActionsCopy, Bubble, FileCard } from "@antdv-next/x";
import type { ItemType as ActionItemType } from "@antdv-next/x";
import { ReloadOutlined, WarningOutlined } from "@antdv-next/icons";
import { Image } from "antdv-next";
import { computed, h } from "vue";
import { store } from "../store";
import { answerText, userText, type Turn } from "../transcript";
import type { Block } from "../types";
import PlanCard from "./PlanCard.vue";
import ProviderIcon from "./ProviderIcon.vue";
import ReasoningBlock from "./ReasoningBlock.vue";
import TextBlock from "./TextBlock.vue";
import ToolChain from "./ToolChain.vue";

const props = defineProps<{
  turn: Turn;
  conversationId: string;
  agentId?: string;
  agentName?: string;
  live: boolean;
  isLast?: boolean;
  canRetry: boolean;
}>();

const emit = defineEmits<{ retry: [blocks: Block[]] }>();

const text = computed(() => answerText(props.turn));
const userBlocks = computed(() => props.turn.user?.blocks ?? []);
const userPrompt = computed(() => userText(userBlocks.value));
const userImages = computed(() =>
  userBlocks.value.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image"),
);
const links = computed(() =>
  userBlocks.value.filter((b): b is Extract<Block, { type: "resource_link" }> => b.type === "resource_link"),
);

const ended = computed(() => Boolean(props.turn.end));
const streaming = computed(() => props.live && !ended.value);
const failed = computed(
  () => props.turn.end && props.turn.end.stopReason !== "end_turn" && props.turn.end.stopReason !== "cancelled",
);

const durationText = computed(() => {
  const d = props.turn.end?.durationMs;
  if (!d || d < 1000) return "";
  const s = Math.round(d / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
});

const reasoningSeconds = computed(() => {
  const thought = props.turn.segments.find((s) => s.kind === "thought");
  if (!thought || thought.kind !== "thought" || !thought.endedAt) return undefined;
  return Math.max(1, Math.round((thought.endedAt - thought.startedAt) / 1000));
});

const hasAnswer = computed(() => text.value.length > 0);
const hasAgentContent = computed(() => props.turn.segments.length > 0 || streaming.value || failed.value);

const actionItems = computed<ActionItemType[]>(() => {
  const items: ActionItemType[] = [
    {
      key: "copy",
      label: "复制回答",
      actionRender: () => h(ActionsCopy, { text: text.value }),
    },
  ];
  if (props.canRetry && props.turn.user) {
    items.push({
      key: "retry",
      label: "重新发送",
      icon: h(ReloadOutlined),
      onItemClick: () => {
        if (props.turn.user) emit("retry", props.turn.user.blocks);
      },
    });
  }
  return items;
});
</script>

<template>
  <div class="turn" :class="{ last: isLast || live }">
    <!-- User Bubble with local custom avatar -->
    <div v-if="turn.user" class="mine bubble-fade-in">
      <Bubble
        placement="end"
        variant="filled"
        shape="corner"
        class="user-bubble"
        :content="userPrompt || ' '"
      >
        <template #avatar>
          <div class="msg-avatar user-avatar">
            <img v-if="store.userAvatar" :src="store.userAvatar" alt="用户头像" />
            <!-- Lucide User -->
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="default-user-ic"
            >
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
        </template>

        <template #content>
          <div class="user-content">
            <div v-if="userImages.length" class="imgs">
              <Image
                v-for="(img, i) in userImages"
                :key="i"
                :src="`data:${img.mimeType};base64,${img.data}`"
                class="user-img"
                alt="附件图片"
              />
            </div>
            <div v-if="links.length" class="file-cards">
              <FileCard
                v-for="(l, i) in links"
                :key="i"
                :name="l.name"
                :byte="l.size"
                size="small"
                class="oc-file-card"
              />
            </div>
            <div v-if="userPrompt" class="user-text">{{ userPrompt }}</div>
          </div>
        </template>
      </Bubble>
    </div>

    <!-- Agent Bubble with provider logo avatar, XMarkdown rendering, and @antdv-next/x Actions -->
    <div v-if="hasAgentContent" class="theirs bubble-fade-in">
      <Bubble
        placement="start"
        variant="borderless"
        class="agent-bubble"
        :content="text || ' '"
      >
        <template #avatar>
          <div class="msg-avatar agent-avatar" :title="agentName || 'Agent'">
            <ProviderIcon :id="agentId || ''" :name="agentName" :size="17" />
          </div>
        </template>

        <template #header>
          <div class="agent-row">
            <span class="agent-label">{{ agentName || "Agent" }}</span>
            <span v-if="streaming" class="agent-live">
              <span class="live-dot" />
              <span>处理中</span>
            </span>
          </div>
        </template>

        <template #content>
          <div class="agent-body">
            <template v-for="(seg, si) in turn.segments" :key="seg.id">
              <ReasoningBlock
                v-if="seg.kind === 'thought'"
                :text="seg.text"
                :live="streaming && !seg.endedAt"
                :duration-sec="reasoningSeconds"
              />
              <PlanCard v-else-if="seg.kind === 'plan'" :entries="seg.entries" />
              <ToolChain v-else-if="seg.kind === 'tools'" :calls="seg.calls" :live="streaming" />
              <div v-else-if="seg.kind === 'notice'" class="notice" :class="seg.level">{{ seg.text }}</div>
              <div v-else-if="seg.kind === 'text'" class="answer">
                <TextBlock :content="seg.text" :streaming="streaming && si === turn.segments.length - 1" />
              </div>
            </template>

            <div v-if="streaming && !hasAnswer && turn.segments.length === 0" class="working">
              <span class="dots"><i /><i /><i /></span>
              <span class="shimmer-text">正在思考并准备执行…</span>
            </div>

            <div v-if="failed" class="notice error">
              <WarningOutlined />
              <span>
                {{
                  turn.end?.error ||
                  (turn.end?.stopReason === "max_tokens" ? "回答超长被截断" : `回合结束：${turn.end?.stopReason}`)
                }}
              </span>
            </div>
            <div v-else-if="turn.end?.stopReason === 'cancelled' && !streaming" class="notice info">已停止生成</div>
          </div>
        </template>

        <template v-if="!streaming && hasAnswer" #footer>
          <div class="foot" :class="{ visible: isLast }">
            <Actions :items="actionItems" variant="borderless" class="oc-actions" />
            <span v-if="durationText" class="took mono">{{ durationText }}</span>
          </div>
        </template>
      </Bubble>
    </div>
  </div>
</template>

<style scoped>
.turn {
  padding: 6px 0 4px;
  content-visibility: auto;
  contain-intrinsic-size: auto 220px;
}
.turn.last {
  content-visibility: visible;
}
.turn + .turn {
  padding-top: 18px;
}
@keyframes oc-bubble-fade-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.992);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.bubble-fade-in {
  animation: oc-bubble-fade-in 0.26s var(--ease) both;
}

.msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex: none;
  background: var(--surface);
  backdrop-filter: var(--glass-blur-sm);
  -webkit-backdrop-filter: var(--glass-blur-sm);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-card);
  color: var(--text-2);
}
.user-avatar {
  margin-top: 5px;
}
.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.default-user-ic {
  width: 15px;
  height: 15px;
}
.agent-avatar {
  border-radius: 50%;
}

/* Shared Bubble avatar column alignment */
.user-bubble :deep(.antd-bubble-avatar),
.agent-bubble :deep(.antd-bubble-avatar) {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-width: 32px;
  flex: none;
}

/* User Bubble */
.mine {
  margin-bottom: 12px;
}
.user-bubble {
  width: 100%;
}
.user-bubble :deep(.antd-bubble-body) {
  max-width: 74%;
}
.user-bubble :deep(.antd-bubble-content) {
  background: var(--user-bubble) !important;
  backdrop-filter: var(--glass-blur-sm);
  -webkit-backdrop-filter: var(--glass-blur-sm);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card);
  color: var(--text);
  font-size: 14px;
  line-height: 1.66;
  padding: 10px 15px !important;
  border-radius: 16px 16px 5px 16px !important;
}
.user-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.user-text {
  white-space: pre-wrap;
  word-break: break-word;
}
.imgs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-start;
}
.imgs :deep(.ant-image-img) {
  max-height: 180px;
  max-width: 240px;
  border-radius: 10px;
  border: 1px solid var(--border);
  object-fit: cover;
  display: block;
}
.file-cards {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-start;
}
.oc-file-card {
  max-width: 240px;
}

/* Agent Bubble */
.theirs {
  min-width: 0;
}
.agent-bubble {
  width: 100%;
}
.agent-bubble :deep(.antd-bubble-body) {
  flex: 1;
  min-width: 0;
  max-width: 100%;
}
.agent-bubble :deep(.antd-bubble-content) {
  padding: 0 !important;
  background: transparent !important;
  width: 100%;
}
.agent-bubble :deep(.antd-bubble-header) {
  margin-bottom: 2px;
}
.agent-bubble :deep(.antd-bubble-footer) {
  margin-top: 2px;
}

.agent-row {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  line-height: 1;
}
.agent-label {
  font-size: 12.5px;
  font-weight: 580;
  color: var(--text-2);
}
.agent-live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-3);
}
.live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ok);
  animation: oc-pulse 1.2s ease-in-out infinite;
}

.agent-body {
  min-width: 0;
}

.answer {
  margin: 0 0 6px;
}

.working {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-3);
  padding: 2px 0 6px;
}
.dots {
  display: inline-flex;
  gap: 3px;
}
.dots i {
  width: 4.5px;
  height: 4.5px;
  border-radius: 50%;
  background: var(--text-3);
  animation: oc-pulse 1.2s ease-in-out infinite;
}
.dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.dots i:nth-child(3) {
  animation-delay: 0.3s;
}

.notice {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--text-2);
  margin: 6px 0 10px;
}
.notice.error {
  color: var(--err);
  background: var(--err-soft);
  border-radius: 8px;
  padding: 7px 10px;
}
.notice.warn {
  color: var(--warn);
}

.foot {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  opacity: 0;
  transition: opacity 0.15s var(--ease);
}
.foot.visible {
  opacity: 0.72;
}
.turn:hover .foot {
  opacity: 1;
}
.oc-actions :deep(.antd-actions-item) {
  color: var(--text-3);
}
.oc-actions :deep(.antd-actions-item:hover) {
  color: var(--text);
}
.took {
  font-size: 11px;
  color: var(--text-3);
  margin-left: 4px;
}
</style>

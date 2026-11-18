<script setup lang="ts">
import { Bubble } from "@antdv-next/x";
import { CheckOutlined, CopyOutlined, ReloadOutlined, WarningOutlined } from "@antdv-next/icons";
import { Tooltip, message } from "antdv-next";
import { computed, ref } from "vue";
import { answerText, userText, type Turn } from "../transcript";
import type { Block } from "../types";
import DiffView from "./DiffView.vue";
import PermissionCard from "./PermissionCard.vue";
import PlanCard from "./PlanCard.vue";
import ReasoningBlock from "./ReasoningBlock.vue";
import TextBlock from "./TextBlock.vue";
import ToolChain from "./ToolChain.vue";

const props = defineProps<{
  turn: Turn;
  conversationId: string;
  live: boolean;
  canRetry: boolean;
}>();

const emit = defineEmits<{ retry: [blocks: Block[]] }>();

const copied = ref(false);
const text = computed(() => answerText(props.turn));
const userBlocks = computed(() => props.turn.user?.blocks ?? []);
const userImages = computed(() =>
  userBlocks.value.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image"),
);
const links = computed(() => userBlocks.value.filter((b): b is Extract<Block, { type: "resource_link" }> => b.type === "resource_link"));

const ended = computed(() => Boolean(props.turn.end));
const streaming = computed(() => props.live && !ended.value);
const failed = computed(() => props.turn.end && props.turn.end.stopReason !== "end_turn" && props.turn.end.stopReason !== "cancelled");

const durationText = computed(() => {
  const d = props.turn.end?.durationMs;
  if (!d || d < 1000) return "";
  const s = Math.round(d / 1000);
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
});

const reasoningSeconds = computed(() => {
  const thought = props.turn.segments.find((s) => s.kind === "thought");
  if (!thought || thought.kind !== "thought" || !thought.endedAt) return undefined;
  return Math.max(1, Math.round((thought.endedAt - thought.startedAt) / 1000));
});

async function copy() {
  try {
    await navigator.clipboard.writeText(text.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1400);
  } catch {
    message.error("复制失败");
  }
}

const hasAnswer = computed(() => text.value.length > 0);
</script>

<template>
  <div class="turn rise" :class="{ last: live }">
    <div v-if="turn.user" class="mine">
      <Bubble
        v-if="userText(userBlocks)"
        placement="end"
        variant="filled"
        shape="corner"
        class="bubble"
        :content="userText(userBlocks)"
      />
      <div v-if="userImages.length" class="imgs">
        <img v-for="(img, i) in userImages" :key="i" :src="`data:${img.mimeType};base64,${img.data}`" alt="" />
      </div>
      <div v-if="links.length" class="links">
        <span v-for="(l, i) in links" :key="i" class="link mono">@{{ l.name }} </span>
      </div>
    </div>

    <div class="theirs">
      <template v-for="seg in turn.segments" :key="seg.id">
        <ReasoningBlock
          v-if="seg.kind === 'thought'"
          :text="seg.text"
          :live="streaming && !seg.endedAt"
          :duration-sec="reasoningSeconds"
        />
        <PlanCard v-else-if="seg.kind === 'plan'" :entries="seg.entries" />
        <ToolChain v-else-if="seg.kind === 'tools'" :calls="seg.calls" :live="streaming" />
        <PermissionCard
          v-else-if="seg.kind === 'permission'"
          :conversation-id="conversationId"
          :request-id="seg.requestId"
          :options="seg.options"
          :title="seg.toolCall?.title || seg.toolCall?.kind || '需要你的确认'"
          :detail="seg.toolCall?.locations?.[0]?.path"
          :resolved="seg.resolved"
        />
        <div v-else-if="seg.kind === 'notice'" class="notice" :class="seg.level">{{ seg.text }}</div>
        <div v-else-if="seg.kind === 'text'" class="answer">
          <TextBlock :content="seg.text" :streaming="streaming" />
        </div>
      </template>

      <div v-if="streaming && !hasAnswer && turn.segments.length === 0" class="working">
        <span class="dots"><i /><i /><i /></span>
        <span class="shimmer-text">正在准备</span>
      </div>

      <div v-if="failed" class="notice error">
        <WarningOutlined />
        <span>{{ turn.end?.error || (turn.end?.stopReason === "max_tokens" ? "回答超长被截断" : `回合结束：${turn.end?.stopReason}`) }}</span>
      </div>
      <div v-else-if="turn.end?.stopReason === 'cancelled' && !streaming" class="notice info">已停止</div>

      <div v-if="!streaming && hasAnswer" class="foot">
        <Tooltip :title="copied ? '已复制' : '复制回答'">
          <button class="act" @click="copy">
            <CheckOutlined v-if="copied" />
            <CopyOutlined v-else />
          </button>
        </Tooltip>
        <Tooltip v-if="canRetry && turn.user" title="重新发送">
          <button class="act" @click="emit('retry', turn.user.blocks)"><ReloadOutlined /></button>
        </Tooltip>
        <span v-if="durationText" class="took">{{ durationText }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.turn {
  padding: 10px 0 6px;
}
.turn + .turn {
  padding-top: 22px;
}

.mine {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  margin-bottom: 16px;
}
.bubble {
  max-width: 78%;
}
.bubble :deep(.antd-bubble-content) {
  background: var(--user-bubble) !important;
  color: var(--text);
  font-size: 14px;
  line-height: 1.68;
  padding: 9px 14px !important;
  white-space: pre-wrap;
  word-break: break-word;
}
.bubble :deep(.antd-bubble-body) {
  max-width: 100%;
}
.imgs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.imgs img {
  max-height: 180px;
  max-width: 260px;
  border-radius: 10px;
  border: 1px solid var(--border);
}
.links {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.link {
  font-size: 11.5px;
  color: var(--text-2);
  background: var(--hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1px 7px;
}

.theirs {
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
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
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
  gap: 2px;
  margin-top: 2px;
  height: 26px;
  opacity: 0;
  transition: opacity 0.15s var(--ease);
}
.turn:hover .foot {
  opacity: 1;
}
.act {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}
.act:hover {
  background: var(--hover);
  color: var(--text);
}
.took {
  font-size: 11px;
  color: var(--text-3);
  margin-left: 6px;
}
</style>

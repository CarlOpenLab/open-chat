<script setup lang="ts">
import { Actions, ActionsCopy, Bubble, BubbleDivider, FileCard } from "@antdv-next/x";
import type { ItemType as ActionItemType } from "@antdv-next/x";
import { ReloadOutlined, WarningOutlined } from "@antdv-next/icons";
import { Image } from "antdv-next";
import { computed, h, ref } from "vue";
import { store } from "../store";
import { stateForTurn } from "../botAvatar";
import { answerText, userText, type Turn } from "../transcript";
import type { Block } from "../types";
import BotAvatar from "./BotAvatar.vue";
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
  botName?: string;
  botAvatar?: string;
  live: boolean;
  isLast?: boolean;
  pendingPerm?: boolean;
  canRetry: boolean;
}>();

const showBotContext = ref(false);

const emit = defineEmits<{ retry: [blocks: Block[]] }>();

const text = computed(() => answerText(props.turn));
const userBlocks = computed(() => props.turn.user?.blocks ?? []);
const userPrompt = computed(() => userText(userBlocks.value));
const parsedBotPrompt = computed(() => {
  const raw = userPrompt.value;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("<bot-context>")) {
    return { context: "", task: raw };
  }
  const end = trimmed.indexOf("</bot-context>");
  if (end === -1) {
    return { context: "", task: raw };
  }
  const context = trimmed.slice("<bot-context>".length, end).trim();
  const task = trimmed.slice(end + "</bot-context>".length).trim();
  return { context, task };
});
const displayUserPrompt = computed(() => parsedBotPrompt.value.task || userPrompt.value);
const botDividerContent = computed(() =>
  h(
    "button",
    {
      type: "button",
      class:
        "inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-[11.5px] text-ink-3 cursor-pointer transition-colors hover:text-ink-2",
      onClick: () => {
        showBotContext.value = !showBotContext.value;
      },
    },
    [
      h("span", `已加载「${props.botName || "Bot"}」人设与长期记忆`),
      h("span", { class: "text-[11px] opacity-70" }, showBotContext.value ? "收起" : "查看"),
    ],
  ),
);
const userImages = computed(() =>
  userBlocks.value.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image"),
);
const links = computed(() =>
  userBlocks.value.filter((b): b is Extract<Block, { type: "resource_link" }> => b.type === "resource_link"),
);

const ended = computed(() => Boolean(props.turn.end));
const streaming = computed(() => props.live && !ended.value);
const failed = computed(
  () => Boolean(props.turn.end && props.turn.end.stopReason !== "end_turn" && props.turn.end.stopReason !== "cancelled"),
);
const botState = computed(() =>
  stateForTurn({
    turn: props.turn,
    streaming: streaming.value,
    failed: failed.value,
    isLast: Boolean(props.isLast),
    pendingPerm: Boolean(props.pendingPerm),
  }),
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
  <div
    class="oc-turn group/turn pt-[6px] pb-1 [&+.oc-turn]:pt-[18px]"
    :class="isLast || live ? '[content-visibility:visible]' : '[content-visibility:auto] [contain-intrinsic-size:auto_220px]'"
  >
    <!-- Bot context divider bubble (outside user bubble, clean & non-intrusive) -->
    <div v-if="parsedBotPrompt.context" class="mb-3">
      <BubbleDivider
        :content="botDividerContent"
        :divider-props="{ plain: true, style: { margin: '4px 0' } }"
      />
      <div
        v-if="showBotContext"
        class="mx-auto max-w-[680px] mt-1.5 rounded-[10px] border border-solid border-line bg-hover px-3 py-2 text-[11px] font-mono leading-[1.55] text-ink-3 whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto"
      >
        {{ parsedBotPrompt.context }}
      </div>
    </div>

    <!-- User Bubble with local custom avatar -->
    <div v-if="turn.user" class="mine mb-3 animate-oc-bubble-in">
      <Bubble
        placement="end"
        variant="filled"
        shape="corner"
        class="oc-user-bubble w-full"
        :content="displayUserPrompt || ' '"
      >
        <template #avatar>
          <div class="mt-[5px] w-8 h-8 rounded-full inline-flex items-center justify-center overflow-hidden flex-none bg-surface glass-sm border border-solid border-line-strong shadow-card text-ink-2">
            <img v-if="store.userAvatar" :src="store.userAvatar" alt="用户头像" class="w-full h-full object-cover block" />
            <!-- Lucide User -->
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-[15px] h-[15px]"
            >
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
        </template>

        <template #content>
          <div class="flex flex-col gap-2">
            <div v-if="userImages.length" class="oc-turn-imgs flex gap-[6px] flex-wrap justify-start">
              <Image
                v-for="(img, i) in userImages"
                :key="i"
                :src="`data:${img.mimeType};base64,${img.data}`"
                alt="附件图片"
              />
            </div>
            <div v-if="links.length" class="flex gap-[6px] flex-wrap justify-start">
              <FileCard
                v-for="(l, i) in links"
                :key="i"
                :name="l.name"
                :byte="l.size"
                size="small"
                class="max-w-[240px]"
              />
            </div>
            <div v-if="displayUserPrompt" class="user-text whitespace-pre-wrap break-words">{{ displayUserPrompt }}</div>
          </div>
        </template>
      </Bubble>
    </div>

    <!-- Agent Bubble with provider logo avatar, XMarkdown rendering, and @antdv-next/x Actions -->
    <div v-if="hasAgentContent" class="min-w-0 animate-oc-bubble-in">
      <Bubble
        placement="start"
        variant="borderless"
        class="oc-agent-bubble w-full"
        :content="text || ' '"
      >
        <template #avatar>
          <BotAvatar
            v-if="botName"
            :avatar="botAvatar"
            :name="botName"
            :size="32"
            :state="botState"
            :animated="streaming"
            :halo="false"
            interactive
          />
          <div
            v-else
            class="w-8 h-8 rounded-full inline-flex items-center justify-center overflow-hidden flex-none bg-surface glass-sm border border-solid border-line-strong shadow-card text-ink-2"
            :title="agentName || 'Agent'"
          >
            <ProviderIcon :id="agentId || ''" :name="agentName" :size="17" />
          </div>
        </template>

        <template #header>
          <div class="flex items-center gap-[7px] h-8 leading-none">
            <span class="text-[12.5px] fw-580 text-ink-2">{{ botName || agentName || "Agent" }}</span>
            <span
              v-if="botName && agentName"
              class="text-[10.5px] text-ink-3 px-1.5 py-[1px] rounded bg-hover border border-solid border-line"
            >
              {{ agentName }}
            </span>
            <span v-if="streaming" class="inline-flex items-center gap-[5px] text-[11px] text-ink-3">
              <span class="w-[5px] h-[5px] rounded-full bg-ok animate-[oc-pulse_1.2s_ease-in-out_infinite]" />
              <span>处理中</span>
            </span>
          </div>
        </template>

        <template #content>
          <div class="min-w-0">
            <template v-for="(seg, si) in turn.segments" :key="seg.id">
              <ReasoningBlock
                v-if="seg.kind === 'thought'"
                :text="seg.text"
                :live="streaming && !seg.endedAt"
                :duration-sec="reasoningSeconds"
              />
              <PlanCard v-else-if="seg.kind === 'plan'" :entries="seg.entries" />
              <ToolChain v-else-if="seg.kind === 'tools'" :calls="seg.calls" :live="streaming" />
              <div
                v-else-if="seg.kind === 'notice'"
                class="notice flex items-center gap-[7px] text-[12.5px] mt-[6px] mb-[10px]"
                :class="
                  seg.level === 'error'
                    ? 'text-err bg-err-soft rounded-[8px] px-[10px] py-[7px]'
                    : seg.level === 'warn'
                      ? 'text-warn'
                      : 'text-ink-2'
                "
              >
                {{ seg.text }}
              </div>
              <div v-else-if="seg.kind === 'text'" class="mb-[6px]">
                <TextBlock :content="seg.text" :streaming="streaming && si === turn.segments.length - 1" />
              </div>
            </template>

            <div v-if="streaming && !hasAnswer && turn.segments.length === 0" class="flex items-center gap-2 text-[13px] text-ink-3 pt-[2px] pb-[6px]">
              <span class="inline-flex gap-[3px]">
                <i class="w-[4.5px] h-[4.5px] rounded-full bg-ink-3 animate-[oc-pulse_1.2s_ease-in-out_infinite]" />
                <i class="w-[4.5px] h-[4.5px] rounded-full bg-ink-3 animate-[oc-pulse_1.2s_ease-in-out_infinite] [animation-delay:0.15s]" />
                <i class="w-[4.5px] h-[4.5px] rounded-full bg-ink-3 animate-[oc-pulse_1.2s_ease-in-out_infinite] [animation-delay:0.3s]" />
              </span>
              <span class="shimmer-text">正在思考并准备执行…</span>
            </div>

            <div v-if="failed" class="notice flex items-center gap-[7px] text-[12.5px] mt-[6px] mb-[10px] text-err bg-err-soft rounded-[8px] px-[10px] py-[7px]">
              <WarningOutlined />
              <span>
                {{
                  turn.end?.error ||
                  (turn.end?.stopReason === "max_tokens" ? "回答超长被截断" : `回合结束：${turn.end?.stopReason}`)
                }}
              </span>
            </div>
            <div v-else-if="turn.end?.stopReason === 'cancelled' && !streaming" class="notice flex items-center gap-[7px] text-[12.5px] text-ink-2 mt-[6px] mb-[10px]">
              已停止生成
            </div>
          </div>
        </template>

        <template v-if="!streaming && hasAnswer" #footer>
          <div
            class="flex items-center gap-1 h-[26px] transition-opacity duration-150 ease-oc group-hover/turn:opacity-100"
            :class="isLast ? 'opacity-72' : 'opacity-0'"
          >
            <Actions :items="actionItems" variant="borderless" class="oc-actions" />
            <span v-if="durationText" class="text-[11px] text-ink-3 ml-1 font-mono">{{ durationText }}</span>
          </div>
        </template>
      </Bubble>
    </div>
  </div>
</template>

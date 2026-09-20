<script setup lang="ts">
import { Bot, LoaderCircle, Pencil, Trash2 } from "@lucide/vue";
import { Button, Input, Tag, Tooltip } from "antdv-next";
import { computed, h } from "vue";
import type { OpenChatConversation } from "../../composables/useChatPersistence";
import { createStyles } from "../../theme/antdvStyle";
import type { SessionStatus } from "../../utils/sessionStatus";

interface Props {
  conv: OpenChatConversation;
  /** 由会话运行信号推导出的看板状态。 */
  status: SessionStatus;
  /** 模型兜底名：conv.modelId 为空时展示。 */
  agentName?: string;
  /** 运行中会话的已耗时，形如 2:05。 */
  elapsed?: string;
  /** 是否为当前打开（选中）的会话。 */
  active?: boolean;
  /** 是否处于标题编辑态，编辑草稿由 draft 受控。 */
  editing?: boolean;
  draft?: string;
}

const props = withDefaults(defineProps<Props>(), {
  agentName: "API",
  elapsed: "",
  active: false,
  editing: false,
  draft: "",
});

const emit = defineEmits<{
  (e: "open", sessionKey: string): void;
  (e: "startEdit", sessionKey: string): void;
  (e: "confirmEdit", sessionKey: string): void;
  (e: "cancelEdit"): void;
  (e: "delete", sessionKey: string): void;
  (e: "update:draft", value: string): void;
}>();

const useStyles = createStyles(({ token, css }) => ({
  sessionRow: css`
    background: var(--card, #ffffff);
    border: 1px solid var(--border);
    border-radius: ${token.borderRadiusLG}px;
    transition: all ${token.motionDurationMid} ${token.motionEaseInOut};
    &:hover {
      border-color: var(--border-strong);
      background: var(--fill-faint);
    }
    &.is-active {
      border-color: var(--brand-primary);
      background: var(--primary-subtle);
    }
  `,
}));

const { styles } = useStyles();

/** 已产生对话记录的会话不支持删除。 */
const hasChatted = computed(() => Boolean(props.conv.messages && props.conv.messages.length > 0));
const messageCount = computed(() => props.conv.messages?.length ?? 0);

const formatTime = (ts?: number): string => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
</script>

<template>
  <div
    :class="[
      'group relative flex flex-col gap-1.5 p-2.5 cursor-pointer',
      styles.sessionRow,
      { 'is-active': active },
    ]"
    @click="emit('open', String(conv.key))"
  >
    <!-- 顶部：标题 (支持双击 / 悬浮铅笔图标修改) + 状态/删除按钮 -->
    <div class="flex items-center justify-between gap-2 min-w-0">
      <div v-if="editing" class="flex items-center gap-1.5 flex-1 min-w-0" @click.stop>
        <Input
          :value="draft"
          size="small"
          class="!text-xs !py-0.5"
          autofocus
          placeholder="输入新标题，按 Enter 保存..."
          @update:value="(v: string) => emit('update:draft', v)"
          @keydown.enter.prevent="emit('confirmEdit', String(conv.key))"
          @keydown.esc.prevent="emit('cancelEdit')"
          @blur="emit('confirmEdit', String(conv.key))"
        />
      </div>
      <div v-else class="flex items-center gap-1.5 flex-1 min-w-0">
        <span
          class="text-12px font-medium text-foreground truncate cursor-pointer hover:text-brand-accent transition-colors"
          :title="`点击打开会话，双击修改标题：${conv.label}`"
          @dblclick.stop="emit('startEdit', String(conv.key))"
        >
          {{ conv.label }}
        </span>
        <Tooltip title="修改标题">
          <Button
            type="text"
            size="small"
            :icon="h(Pencil)"
            class="!w-4.5 !h-4.5 !p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:!text-foreground transition-opacity flex-none"
            @click.stop="emit('startEdit', String(conv.key))"
          />
        </Tooltip>
      </div>
      <div class="flex items-center gap-1 flex-none" @click.stop>
        <!-- 没聊天过的支持删除；发过消息的不支持删除 -->
        <Tooltip v-if="!hasChatted" title="删除未使用的会话">
          <Button
            type="text"
            size="small"
            danger
            :icon="h(Trash2)"
            class="!w-5.5 !h-5.5 !p-0 opacity-0 group-hover:opacity-100 hover:!bg-red-500/10 text-muted-foreground hover:!text-red-500 transition-opacity"
            @click="emit('delete', String(conv.key))"
          />
        </Tooltip>

        <Tag
          v-if="status === 'running'"
          color="blue"
          class="!m-0 !inline-flex !items-center !gap-1"
        >
          <LoaderCircle class="animate-spin !h-2.5 !w-2.5" />
          {{ elapsed }}
        </Tag>
        <Tag v-else-if="status === 'permission'" color="warning" class="!m-0">待确认</Tag>
        <Tag v-else-if="status === 'queued'" color="purple" class="!m-0">排队</Tag>
        <Tag v-else-if="status === 'stopped'" color="error" class="!m-0">已终止</Tag>
      </div>
    </div>

    <!-- 底部：所用模型展示 + 时间戳 + 消息量 -->
    <div
      class="flex items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/30"
    >
      <div class="flex items-center gap-1.5 min-w-0">
        <!-- 显示使用的模型 -->
        <span
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/80 border border-border/50 text-[10px] font-medium text-foreground max-w-36 truncate"
          :title="`使用的模型：${conv.modelId || agentName}`"
        >
          <Bot class="h-2.5 w-2.5 opacity-70 flex-none" />
          <span class="truncate">{{ conv.modelId || agentName }}</span>
        </span>

        <span
          v-if="hasChatted"
          class="text-[10px] text-muted-foreground/70"
          title="已产生对话记录（不支持删除）"
        >
          {{ messageCount }} 条消息
        </span>
      </div>

      <span class="text-[10px] text-muted-foreground/60 flex-none">
        {{ formatTime(conv.updatedAt) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, Paperclip, Pencil, SendHorizontal, Trash2, X } from "@lucide/vue";
import { Tooltip } from "antdv-next";
import { ref } from "vue";
import type { QueuedChatMessage } from "../../services/chatStorage";
import { createStyles } from "../../theme/antdvStyle";
import type { AccentGlobalToken } from "../../theme/shadcnTheme";

interface Props {
  queuedMessages: QueuedChatMessage[];
  queuePaused: boolean;
  loading: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "change", id: string, content: string): void;
  (e: "remove", id: string): void;
  (e: "clear"): void;
  (e: "send"): void;
}>();

const useStyles = createStyles(({ token, css }) => ({
  root: css`
    padding: 1px 2px 0;

    .queued-message-heading {
      display: flex;
      min-height: 24px;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 6px 4px;
      color: ${token.colorTextTertiary};
      font-size: 11.5px;
      font-weight: 600;
    }
    .queued-message-heading-actions {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .queued-message-state {
      color: ${token.colorWarning};
      font-weight: 500;
    }
    .queued-message-clear {
      display: grid;
      width: 24px;
      height: 24px;
      place-items: center;
      border: 0;
      border-radius: 5px;
      padding: 0;
      background: transparent;
      color: ${token.colorTextTertiary};
      cursor: pointer;
    }
    .queued-message-clear:hover {
      background: ${token.colorErrorBg};
      color: ${token.colorError};
    }
    .queued-message-list {
      display: flex;
      max-height: 190px;
      flex-direction: column;
      gap: 3px;
      overflow-y: auto;
    }
    .queued-message-item {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr) auto;
      min-height: 36px;
      align-items: center;
      gap: 7px;
      border-radius: 6px;
      padding: 4px 5px;
      background: ${token.colorFillTertiary};
    }
    .queued-message-order {
      display: grid;
      width: 20px;
      height: 20px;
      place-items: center;
      border-radius: 50%;
      background: ${token.colorFillSecondary};
      color: ${token.colorTextTertiary};
      font-size: 10.5px;
      font-variant-numeric: tabular-nums;
    }
    .queued-message-copy {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 7px;
    }
    .queued-message-content {
      display: -webkit-box;
      min-width: 0;
      overflow: hidden;
      color: ${token.colorText};
      font-size: 12px;
      line-height: 16px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .queued-message-attachments {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 2px;
      color: ${token.colorTextTertiary};
      font-size: 10.5px;
    }
    .queued-message-editor {
      width: 100%;
      min-height: 40px;
      max-height: 92px;
      resize: vertical;
      border: 1px solid ${token.colorBorder};
      border-radius: 5px;
      padding: 5px 7px;
      outline: none;
      background: ${token.colorBgContainer};
      color: ${token.colorText};
      font: inherit;
      font-size: 12px;
      line-height: 16px;
    }
    .queued-message-editor:focus {
      border-color: ${(token as AccentGlobalToken).colorAccent};
    }
    .queued-message-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .queued-message-action {
      display: grid;
      width: 26px;
      height: 26px;
      place-items: center;
      border: 0;
      border-radius: 5px;
      padding: 0;
      background: transparent;
      color: ${token.colorTextTertiary};
      cursor: pointer;
    }
    .queued-message-action:hover:not(:disabled) {
      background: ${token.colorFillSecondary};
      color: ${token.colorText};
    }
    .queued-message-action.is-primary {
      color: ${(token as AccentGlobalToken).colorAccent};
    }
    .queued-message-action.is-danger:hover:not(:disabled) {
      color: ${token.colorError};
    }
    .queued-message-action:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }
    .queued-message-icon {
      width: 14px;
      height: 14px;
    }
    .queued-message-icon-sm {
      width: 12px;
      height: 12px;
    }
  `,
}));

const { styles } = useStyles();

const editingQueueId = ref("");
const editingQueueValue = ref("");

const startQueueEdit = (item: QueuedChatMessage) => {
  editingQueueId.value = item.id;
  editingQueueValue.value = item.content;
};

const cancelQueueEdit = () => {
  editingQueueId.value = "";
  editingQueueValue.value = "";
};

const saveQueueEdit = (item: QueuedChatMessage) => {
  const content = editingQueueValue.value.trim();
  if (!content && !item.attachments?.length) return;
  emit("change", item.id, content);
  cancelQueueEdit();
};

const handleQueueEditKeydown = (event: KeyboardEvent, item: QueuedChatMessage) => {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelQueueEdit();
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    saveQueueEdit(item);
  }
};
</script>

<template>
  <div class="queued-message-panel" :class="styles.root">
    <div class="queued-message-heading">
      <span>待发送 · {{ props.queuedMessages.length }}</span>
      <div class="queued-message-heading-actions">
        <span v-if="queuePaused" class="queued-message-state">已暂停</span>
        <Tooltip title="清空队列">
          <button
            type="button"
            class="queued-message-clear"
            aria-label="清空队列"
            @click="emit('clear')"
          >
            <Trash2 class="queued-message-icon" />
          </button>
        </Tooltip>
      </div>
    </div>
    <div class="queued-message-list">
      <div v-for="(item, index) in props.queuedMessages" :key="item.id" class="queued-message-item">
        <span class="queued-message-order">{{ index + 1 }}</span>
        <textarea
          v-if="editingQueueId === item.id"
          v-model="editingQueueValue"
          class="queued-message-editor"
          rows="2"
          @keydown="handleQueueEditKeydown($event, item)"
        ></textarea>
        <div v-else class="queued-message-copy">
          <span class="queued-message-content">{{ item.content || "仅附件" }}</span>
          <span v-if="item.attachments?.length" class="queued-message-attachments">
            <Paperclip class="queued-message-icon-sm" />{{ item.attachments.length }}
          </span>
        </div>
        <div class="queued-message-actions">
          <template v-if="editingQueueId === item.id">
            <Tooltip title="保存">
              <button
                type="button"
                class="queued-message-action"
                aria-label="保存队列消息"
                :disabled="!editingQueueValue.trim() && !item.attachments?.length"
                @click="saveQueueEdit(item)"
              >
                <Check class="queued-message-icon" />
              </button>
            </Tooltip>
            <Tooltip title="取消">
              <button
                type="button"
                class="queued-message-action"
                aria-label="取消编辑"
                @click="cancelQueueEdit"
              >
                <X class="queued-message-icon" />
              </button>
            </Tooltip>
          </template>
          <template v-else>
            <Tooltip v-if="index === 0 && !loading" title="发送下一条">
              <button
                type="button"
                class="queued-message-action is-primary"
                aria-label="发送下一条队列消息"
                @click="emit('send')"
              >
                <SendHorizontal class="queued-message-icon" />
              </button>
            </Tooltip>
            <Tooltip title="编辑">
              <button
                type="button"
                class="queued-message-action"
                aria-label="编辑队列消息"
                @click="startQueueEdit(item)"
              >
                <Pencil class="queued-message-icon" />
              </button>
            </Tooltip>
            <Tooltip title="删除">
              <button
                type="button"
                class="queued-message-action is-danger"
                aria-label="删除队列消息"
                @click="emit('remove', item.id)"
              >
                <Trash2 class="queued-message-icon" />
              </button>
            </Tooltip>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

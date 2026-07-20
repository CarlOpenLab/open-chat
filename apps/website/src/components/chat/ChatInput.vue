<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import { BulbOutlined, StopOutlined } from "@antdv-next/icons";
import { Button, Dropdown, Tooltip, type MenuProps } from "antdv-next";
import { computed } from "vue";

interface Props {
  modelValue: string;
  loading: boolean;
  currentModel: string;
  currentModelLabel?: string;
  thinkingEnabled: boolean;
  modelItems: NonNullable<MenuProps["items"]>;
}

interface Emits {
  (e: "update:modelValue", value: string): void;
  (e: "change", value: string): void;
  (e: "cancel"): void;
  (e: "submit", value: string): void;
  (e: "modelChange", key: string): void;
  (e: "thinkingChange", value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const handleChange = (value: string) => {
  emit("update:modelValue", value);
  emit("change", value);
};

const handleSubmit = (value: string) => {
  emit("submit", value);
};

const handleCancel = () => {
  emit("cancel");
};

const handleThinkingChange = (checked: boolean) => {
  emit("thinkingChange", checked);
};

const modelMenu = computed<MenuProps>(() => ({
  items: props.modelItems,
  selectedKeys: [props.currentModel],
  onClick: ({ key }) => emit("modelChange", String(key)),
}));
</script>

<template>
  <section class="chat-footer" aria-label="消息输入区">
    <Sender
      :value="modelValue"
      :loading="loading"
      placeholder="发送消息…"
      :on-cancel="handleCancel"
      :on-change="handleChange"
      :on-submit="handleSubmit"
      :suffix="false"
    >
      <template #footer="{ defaultNode }">
        <div class="sender-footer">
          <div class="sender-controls">
            <Dropdown :menu="modelMenu" :trigger="['click']">
              <button
                class="model-switcher"
                type="button"
                :title="currentModelLabel || currentModel"
              >
                {{ currentModelLabel || currentModel || "选择模型" }}
              </button>
            </Dropdown>
            <Tooltip :title="thinkingEnabled ? '关闭深度思考' : '开启深度思考'">
              <Button
                type="text"
                class="thinking-toggle"
                :class="{ active: thinkingEnabled }"
                aria-label="深度思考开关"
                :aria-pressed="thinkingEnabled"
                @click="handleThinkingChange(!thinkingEnabled)"
              >
                <BulbOutlined />
                <span>思考</span>
              </Button>
            </Tooltip>
          </div>

          <div class="sender-actions">
            <span v-if="loading" class="generation-status" aria-live="polite">
              <i></i>
              正在生成
            </span>
            <Tooltip v-if="loading" title="停止生成">
              <button class="stop-button" type="button" aria-label="停止生成" @click="handleCancel">
                <StopOutlined />
              </button>
            </Tooltip>
            <component v-else :is="defaultNode" />
          </div>
        </div>
      </template>
    </Sender>
  </section>
</template>

<style scoped>
.chat-footer {
  padding: 12px var(--chat-gutter) 28px;
  background: var(--brand-workspace);
}

.chat-footer :deep(.x-sender) {
  max-width: var(--chat-content-width);
  margin: 0 auto;
}

:deep(.antd-sender-main) {
  border: 1px solid var(--brand-border-strong);
  border-radius: 8px;
  background: var(--brand-surface);
  box-shadow: var(--brand-shadow-float);
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}

:deep(.antd-sender-main:focus-within) {
  border-color: var(--brand-foreground);
  box-shadow: 0 0 0 3px var(--brand-ring);
}

:deep(.antd-sender-content) {
  align-items: center;
}

.sender-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 40px;
  gap: 8px;
}

.sender-controls,
.sender-actions {
  display: inline-flex;
  align-items: center;
}

.sender-controls {
  min-width: 0;
  gap: 4px;
}

.sender-actions {
  gap: 8px;
}

.model-switcher,
.stop-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease;
}

.model-switcher {
  max-width: 230px;
  overflow: hidden;
  padding: 0 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}

.model-switcher:hover,
.stop-button:hover {
  border-color: var(--brand-border);
  background: var(--brand-surface-muted);
}

.model-switcher:active,
.stop-button:active {
  background: var(--brand-surface-subtle);
  transform: scale(0.97);
}

.thinking-toggle {
  display: inline-flex;
  align-items: center;
  min-width: 32px;
  min-height: 32px;
  gap: 5px;
  border-radius: 6px;
  color: var(--brand-muted-strong);
  font-size: 12px;
  transition:
    background 150ms ease,
    color 150ms ease;
}

.thinking-toggle.active {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}

.generation-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--brand-muted-strong);
  font-size: 12px;
}

.generation-status i {
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-foreground);
  animation: status-pulse 1.2s ease-in-out infinite;
}

.stop-button {
  width: 32px;
  padding: 0;
  color: var(--brand-foreground);
}

@keyframes status-pulse {
  50% {
    opacity: 0.3;
  }
}

@media (max-width: 767px) {
  .chat-footer {
    padding: 10px 16px max(18px, env(safe-area-inset-bottom));
  }

  .model-switcher {
    max-width: 145px;
  }

  .thinking-toggle span,
  .generation-status {
    display: none;
  }
}
</style>

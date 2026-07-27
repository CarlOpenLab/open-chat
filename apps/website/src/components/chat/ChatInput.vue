<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import {
  AudioLines,
  BrainCircuit,
  ChevronDown,
  FolderOpen,
  Globe2,
  SlidersHorizontal,
  Square,
  Sparkles,
} from "@lucide/vue";
import { Badge, Button, Dropdown, Popover, Tooltip, message, type MenuProps } from "antdv-next";
import { computed, ref } from "vue";
import type { AssistantStarterPrompt } from "../../features/assistant-market/types";
import ComposerToolsMenu from "./ComposerToolsMenu.vue";
import StarterPrompts from "./StarterPrompts.vue";

interface Props {
  modelValue: string;
  loading: boolean;
  currentModel: string;
  currentModelLabel?: string;
  modelItems: NonNullable<MenuProps["items"]>;
  thinkingEnabled: boolean;
  fileModeEnabled: boolean;
  searchEnabled: boolean;
  searchAvailable: boolean;
  showStarterPrompts: boolean;
  starterPrompts?: AssistantStarterPrompt[];
  assistantName?: string;
}

interface Emits {
  (e: "update:modelValue", value: string): void;
  (e: "change", value: string): void;
  (e: "cancel"): void;
  (e: "submit", value: string): void;
  (e: "modelChange", key: string): void;
  (e: "thinkingChange", value: boolean): void;
  (e: "fileModeChange", value: boolean): void;
  (e: "searchChange", value: boolean): void;
  (e: "promptClick", info: { data: { key: string; description: string } }): void;
  (e: "assistantSelect"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const toolsOpen = ref(false);
const voiceActive = ref(false);

const modelMenu = computed<MenuProps>(() => ({
  items: props.modelItems,
  selectedKeys: [props.currentModel],
  onClick: ({ key }) => emit("modelChange", String(key)),
}));

const activeTools = computed(() => [
  ...(props.searchEnabled ? [{ key: "search", label: "联网搜索", icon: Globe2 }] : []),
  ...(props.thinkingEnabled ? [{ key: "reason", label: "深度思考", icon: BrainCircuit }] : []),
  ...(props.fileModeEnabled ? [{ key: "files", label: "文件", icon: FolderOpen }] : []),
]);

const handleChange = (value: string) => {
  emit("update:modelValue", value);
  emit("change", value);
};

const handleSubmit = (value: string) => {
  const prompt = value.trim();
  if (!prompt) return;
  emit("submit", prompt);
};

const toggleVoice = () => {
  voiceActive.value = !voiceActive.value;
  message.info(voiceActive.value ? "正在聆听" : "语音输入已停止");
};
</script>

<template>
  <section
    class="chat-footer relative z-12 pt-[26px] px-[max(24px,calc((100%_-_780px)/2))] pb-[max(8px,env(safe-area-inset-bottom))] bg-[linear-gradient(to_bottom,transparent_0,var(--brand-workspace)_32px,var(--brand-workspace)_100%)] lt-md:px-[18px] lt-sm:px-[10px]"
    aria-label="消息输入区"
  >
    <StarterPrompts
      v-if="showStarterPrompts && !loading"
      :items="starterPrompts"
      @prompt-click="emit('promptClick', $event)"
    />

    <Sender
      :value="modelValue"
      :loading="loading"
      placeholder="向 Open Chat 发送消息"
      :on-cancel="() => emit('cancel')"
      :on-change="handleChange"
      :on-submit="handleSubmit"
      :suffix="false"
    >
      <template #footer="{ defaultNode }">
        <div class="flex w-full min-h-[34px] items-center justify-between gap-3">
          <div class="composer-tools flex items-center gap-[3px] lt-sm:gap-0">
            <Tooltip :title="props.assistantName ? `助手：${props.assistantName}` : '选择助手'">
              <Button
                type="text"
                shape="circle"
                class="assistant-picker-button"
                :class="{ 'tool-active': props.assistantName }"
                :aria-label="props.assistantName ? `当前助手：${props.assistantName}` : '选择助手'"
                @click="emit('assistantSelect')"
              >
                <Sparkles />
              </Button>
            </Tooltip>
            <Popover v-model:open="toolsOpen" placement="topLeft" :arrow="false" trigger="click">
              <template #content>
                <ComposerToolsMenu
                  :search-available="props.searchAvailable"
                  :search-enabled="props.searchEnabled"
                  :thinking-enabled="thinkingEnabled"
                  :file-mode-enabled="fileModeEnabled"
                  @search-change="emit('searchChange', $event)"
                  @thinking-change="emit('thinkingChange', $event)"
                  @file-mode-change="emit('fileModeChange', $event)"
                />
              </template>
              <Tooltip title="工具">
                <Badge
                  :count="activeTools.length"
                  :offset="[-4, 4]"
                  class="tools-badge inline-flex"
                >
                  <Button
                    type="text"
                    shape="circle"
                    aria-label="选择工具"
                    :aria-expanded="toolsOpen"
                    :class="{ 'tool-active': activeTools.length > 0 }"
                    ><SlidersHorizontal
                  /></Button>
                </Badge>
              </Tooltip>
            </Popover>
          </div>

          <div class="flex items-center gap-[3px] lt-sm:gap-0">
            <Dropdown :menu="modelMenu" :trigger="['click']" placement="topRight">
              <button
                type="button"
                class="flex min-h-[32px] items-center gap-[5px] py-0 px-2 border-0 rounded-[5px] bg-transparent text-brand-muted text-[10px] font-600 cursor-pointer hover:bg-brand-surface-subtle hover:text-brand-foreground lt-md:min-h-[44px] lt-sm:max-w-[104px] lt-sm:px-[5px]"
              >
                <span class="lt-sm:truncate">{{ currentModelLabel || "选择模型" }}</span
                ><ChevronDown class="w-3 h-3" />
              </button>
            </Dropdown>
            <Tooltip :title="voiceActive ? '停止语音输入' : '语音输入'">
              <button
                type="button"
                class="grid w-[34px] h-[34px] place-items-center p-0 border-0 rounded-md cursor-pointer hover:bg-brand-surface-subtle hover:text-brand-foreground lt-md:w-[44px] lt-md:min-w-[44px] lt-md:h-[44px] lt-md:flex-[0_0_44px] lt-sm:hidden"
                :class="
                  voiceActive
                    ? 'bg-brand-surface-subtle text-brand-foreground'
                    : 'bg-transparent text-brand-muted'
                "
                aria-label="语音输入"
                @click="toggleVoice"
              >
                <AudioLines class="w-[15px] h-[15px]" />
              </button>
            </Tooltip>
            <Tooltip v-if="loading" title="停止生成">
              <button
                type="button"
                class="grid w-[34px] h-[34px] place-items-center p-0 border-0 rounded-md cursor-pointer bg-brand-primary text-brand-primary-foreground lt-md:w-[44px] lt-md:min-w-[44px] lt-md:h-[44px] lt-md:flex-[0_0_44px]"
                aria-label="停止生成"
                @click="emit('cancel')"
              >
                <Square class="w-3 h-3 fill-current" />
              </button>
            </Tooltip>
            <component v-else :is="defaultNode" />
          </div>
        </div>
      </template>
    </Sender>
    <p class="mt-[6px] mx-auto mb-0 text-brand-muted text-[9px] text-center">
      Open Chat 可能会出错，请核查重要信息。
    </p>
  </section>
</template>

<style scoped>
/* 以下均为 :deep() 覆盖 antd / antd-x 内部类，按迁移规范保留在 scoped CSS 中 */

/* 工具按钮角标：count=0 时自动隐藏 */
.composer-tools :deep(.tools-badge .ant-badge-count) {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
  font-size: 9px;
  font-weight: 600;
  line-height: 16px;
}
.chat-footer :deep(.antd-sender) {
  width: 100%;
  max-width: 780px;
  margin: 0 auto;
}
.chat-footer :deep(.antd-sender-main) {
  min-height: 96px;
  padding: 0;
  border: 1px solid var(--brand-border-strong);
  border-radius: 8px;
  background: var(--brand-surface);
  box-shadow:
    0 10px 34px rgba(9, 9, 11, 0.09),
    0 1px 4px rgba(9, 9, 11, 0.04);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}
.chat-footer :deep(.antd-sender-main:focus-within) {
  border-color: var(--brand-foreground);
  box-shadow:
    0 0 0 1px var(--brand-foreground),
    0 10px 34px rgba(9, 9, 11, 0.09);
}
.chat-footer :deep(.antd-sender-content) {
  min-height: 50px;
  align-items: flex-start;
  padding: 12px 12px 2px;
}
.chat-footer :deep(.antd-sender-footer) {
  min-height: 44px;
  padding: 0 12px 10px;
}
.chat-footer :deep(textarea) {
  max-height: 152px;
  min-height: 36px;
  color: var(--brand-foreground);
  caret-color: var(--brand-foreground);
  font-size: 13px;
  line-height: 1.65;
}
.chat-footer :deep(textarea::placeholder) {
  color: var(--brand-muted);
  opacity: 1;
}
.composer-tools :deep(.ant-btn) {
  width: 34px;
  min-width: 34px;
  height: 34px;
  color: var(--brand-muted);
}
.composer-tools :deep(.ant-btn:hover),
.composer-tools :deep(.ant-btn[aria-expanded="true"]),
.composer-tools :deep(.ant-btn.tool-active) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.composer-tools :deep(.assistant-picker-button) {
  position: relative;
}
.composer-tools :deep(.assistant-picker-button.tool-active::after) {
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 5px;
  height: 5px;
  border: 1px solid var(--brand-surface);
  border-radius: 50%;
  background: var(--brand-primary);
  content: "";
}
.chat-footer :deep(.antd-sender-actions-btn) {
  width: 34px;
  min-width: 34px;
  height: 34px;
  border-radius: 6px;
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
  box-shadow: var(--brand-shadow-xs);
}
.chat-footer :deep(.antd-sender-actions-btn:disabled) {
  opacity: 0.26;
}
@media (max-width: 820px) {
  .composer-tools :deep(.ant-btn),
  .chat-footer :deep(.antd-sender-actions-btn) {
    width: 44px;
    min-width: 44px;
    height: 44px;
    flex: 0 0 44px;
  }
  .chat-footer :deep(textarea) {
    font-size: 16px;
  }
}
@media (max-width: 560px) {
  .chat-footer :deep(.antd-sender-main) {
    min-height: 102px;
    padding: 0;
    border-radius: 7px;
  }
  .chat-footer :deep(.antd-sender-content) {
    padding-inline: 12px;
  }
  .chat-footer :deep(.antd-sender-footer) {
    padding-inline: 8px;
  }
}
</style>

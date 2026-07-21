<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import {
  AudioLines,
  BrainCircuit,
  ChevronDown,
  FileText,
  Globe2,
  PanelTop,
  Paperclip,
  SlidersHorizontal,
  Square,
  X,
} from "@lucide/vue";
import { Button, Dropdown, Popover, Switch, Tooltip, message, type MenuProps } from "antdv-next";
import { computed, ref } from "vue";

interface Props {
  modelValue: string;
  loading: boolean;
  currentModel: string;
  currentModelLabel?: string;
  modelItems: NonNullable<MenuProps["items"]>;
  thinkingEnabled: boolean;
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
const fileInput = ref<HTMLInputElement>();
const selectedFile = ref<File>();
const toolsOpen = ref(false);
const searchEnabled = ref(false);
const canvasEnabled = ref(false);
const voiceActive = ref(false);

const modelMenu = computed<MenuProps>(() => ({
  items: props.modelItems,
  selectedKeys: [props.currentModel],
  onClick: ({ key }) => emit("modelChange", String(key)),
}));

const activeTools = computed(() => [
  ...(searchEnabled.value ? [{ key: "search", label: "联网搜索", icon: Globe2 }] : []),
  ...(props.thinkingEnabled ? [{ key: "reason", label: "深度思考", icon: BrainCircuit }] : []),
  ...(canvasEnabled.value ? [{ key: "canvas", label: "画布", icon: PanelTop }] : []),
]);

const handleChange = (value: string) => {
  emit("update:modelValue", value);
  emit("change", value);
};

const handleSubmit = (value: string) => {
  const prompt =
    value.trim() || (selectedFile.value ? `请分析附件 ${selectedFile.value.name}` : "");
  if (!prompt) return;
  emit("submit", prompt);
  selectedFile.value = undefined;
  if (fileInput.value) fileInput.value.value = "";
};

const handleFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  selectedFile.value = input.files?.[0];
  if (selectedFile.value) message.success("附件已添加");
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const toggleVoice = () => {
  voiceActive.value = !voiceActive.value;
  message.info(voiceActive.value ? "正在聆听" : "语音输入已停止");
};
</script>

<template>
  <section class="chat-footer" aria-label="消息输入区">
    <div v-if="selectedFile" class="attachment-preview">
      <div class="file-chip">
        <span class="file-icon"><FileText /></span>
        <span
          ><strong>{{ selectedFile.name }}</strong
          ><small>{{ formatSize(selectedFile.size) }}</small></span
        >
        <button type="button" aria-label="移除附件" @click="selectedFile = undefined"><X /></button>
      </div>
    </div>

    <div v-if="activeTools.length" class="active-tools">
      <span v-for="tool in activeTools" :key="tool.key"
        ><component :is="tool.icon" />{{ tool.label }}</span
      >
    </div>

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
        <div class="sender-footer">
          <div class="composer-tools">
            <Tooltip title="添加附件">
              <Button type="text" shape="circle" aria-label="添加附件" @click="fileInput?.click()"
                ><Paperclip
              /></Button>
            </Tooltip>
            <input ref="fileInput" class="file-input" type="file" @change="handleFileChange" />

            <Popover v-model:open="toolsOpen" placement="topLeft" :arrow="false" trigger="click">
              <template #content>
                <div class="tools-menu">
                  <p>增强回答</p>
                  <button type="button" @click="searchEnabled = !searchEnabled">
                    <span><Globe2 /></span
                    ><span><strong>联网搜索</strong><small>查找并引用最新信息</small></span
                    ><Switch :checked="searchEnabled" size="small" />
                  </button>
                  <button type="button" @click="emit('thinkingChange', !thinkingEnabled)">
                    <span><BrainCircuit /></span
                    ><span><strong>深度思考</strong><small>为复杂问题投入更多时间</small></span
                    ><Switch :checked="thinkingEnabled" size="small" />
                  </button>
                  <button type="button" @click="canvasEnabled = !canvasEnabled">
                    <span><PanelTop /></span
                    ><span><strong>画布</strong><small>在独立空间编辑长内容</small></span
                    ><Switch :checked="canvasEnabled" size="small" />
                  </button>
                </div>
              </template>
              <Tooltip title="工具">
                <Button type="text" shape="circle" aria-label="选择工具" :aria-expanded="toolsOpen"
                  ><SlidersHorizontal
                /></Button>
              </Tooltip>
            </Popover>
          </div>

          <div class="composer-submit-group">
            <Dropdown :menu="modelMenu" :trigger="['click']" placement="topRight">
              <button class="model-button" type="button">
                <span>{{ currentModelLabel || "选择模型" }}</span
                ><ChevronDown />
              </button>
            </Dropdown>
            <Tooltip :title="voiceActive ? '停止语音输入' : '语音输入'">
              <button
                class="voice-button"
                :class="{ active: voiceActive }"
                type="button"
                aria-label="语音输入"
                @click="toggleVoice"
              >
                <AudioLines />
              </button>
            </Tooltip>
            <Tooltip v-if="loading" title="停止生成">
              <button
                class="stop-button"
                type="button"
                aria-label="停止生成"
                @click="emit('cancel')"
              >
                <Square />
              </button>
            </Tooltip>
            <component v-else :is="defaultNode" />
          </div>
        </div>
      </template>
    </Sender>
    <p class="ai-disclaimer">Open Chat 可能会出错，请核查重要信息。</p>
  </section>
</template>

<style scoped>
.chat-footer {
  position: relative;
  z-index: 12;
  padding: 26px max(24px, calc((100% - 780px) / 2)) max(8px, env(safe-area-inset-bottom));
  background: linear-gradient(
    to bottom,
    transparent 0,
    var(--brand-workspace) 32px,
    var(--brand-workspace) 100%
  );
}
.attachment-preview,
.active-tools {
  width: 100%;
  max-width: 780px;
  margin: 0 auto 7px;
}
.file-chip {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 9px;
  width: fit-content;
  max-width: 100%;
  min-height: 48px;
  padding: 6px 7px;
  border: 1px solid var(--brand-border);
  border-radius: 6px;
  background: var(--brand-surface);
  box-shadow: var(--brand-shadow-xs);
}
.file-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 5px;
  background: var(--brand-surface-subtle);
}
.file-icon :deep(svg) {
  width: 15px;
  height: 15px;
}
.file-chip > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.file-chip strong {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-chip small {
  color: var(--brand-muted);
  font-size: 9px;
}
.file-chip button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--brand-muted);
  cursor: pointer;
}
.file-chip button:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.file-chip button :deep(svg) {
  width: 13px;
  height: 13px;
}
.active-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.active-tools > span {
  display: inline-flex;
  min-height: 27px;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--brand-border);
  border-radius: 5px;
  background: var(--brand-surface);
  color: var(--brand-muted);
  font-size: 9px;
}
.active-tools :deep(svg) {
  width: 12px;
  height: 12px;
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
.sender-footer {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.composer-tools,
.composer-submit-group {
  display: flex;
  align-items: center;
  gap: 3px;
}
.composer-tools :deep(.ant-btn) {
  width: 34px;
  min-width: 34px;
  height: 34px;
  color: var(--brand-muted);
}
.composer-tools :deep(.ant-btn:hover),
.composer-tools :deep(.ant-btn[aria-expanded="true"]) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.model-button {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--brand-muted);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}
.model-button:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.model-button :deep(svg) {
  width: 12px;
  height: 12px;
}
.voice-button,
.stop-button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.voice-button {
  background: transparent;
  color: var(--brand-muted);
}
.voice-button:hover,
.voice-button.active {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.voice-button :deep(svg) {
  width: 15px;
  height: 15px;
}
.stop-button {
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
}
.stop-button :deep(svg) {
  width: 12px;
  height: 12px;
  fill: currentColor;
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
.ai-disclaimer {
  margin: 6px auto 0;
  color: var(--brand-muted);
  font-size: 9px;
  text-align: center;
}
.tools-menu {
  width: 302px;
  padding: 5px;
}
.tools-menu > p {
  margin: 3px 7px 6px;
  color: var(--brand-muted);
  font-size: 10px;
  font-weight: 600;
}
.tools-menu > button {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 30px;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 58px;
  padding: 7px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--brand-foreground);
  text-align: left;
  cursor: pointer;
}
.tools-menu > button:hover {
  background: var(--brand-surface-subtle);
}
.tools-menu > button > span:first-child {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 5px;
  background: var(--brand-surface);
}
.tools-menu > button > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.tools-menu strong {
  font-size: 11px;
}
.tools-menu small {
  color: var(--brand-muted);
  font-size: 9px;
}
.tools-menu :deep(svg) {
  width: 15px;
  height: 15px;
}
:global(.ant-popover-inner:has(.tools-menu)) {
  padding: 0 !important;
  border: 1px solid var(--brand-border);
  border-radius: 7px !important;
  background: var(--brand-surface) !important;
  box-shadow: var(--shadow-xl) !important;
}
@media (max-width: 820px) {
  .chat-footer {
    padding-left: 18px;
    padding-right: 18px;
  }
  .composer-tools :deep(.ant-btn),
  .voice-button,
  .stop-button,
  .chat-footer :deep(.antd-sender-actions-btn) {
    width: 44px;
    min-width: 44px;
    height: 44px;
    flex: 0 0 44px;
  }
  .model-button {
    min-height: 44px;
  }
  .chat-footer :deep(textarea) {
    font-size: 16px;
  }
  .file-chip {
    grid-template-columns: 34px minmax(0, 1fr) 44px;
  }
  .file-chip button {
    width: 44px;
    height: 44px;
  }
}
@media (max-width: 560px) {
  .chat-footer {
    padding-left: 10px;
    padding-right: 10px;
  }
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
  .composer-tools,
  .composer-submit-group {
    gap: 0;
  }
  .model-button {
    max-width: 104px;
    padding: 0 5px;
  }
  .model-button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .voice-button {
    display: none;
  }
  .tools-menu {
    width: min(302px, calc(100vw - 20px));
  }
}
</style>

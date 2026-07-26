<script setup lang="ts">
import { Prompts, Sender, type PromptsItemType } from "@antdv-next/x";
import {
  AudioLines,
  BrainCircuit,
  ChevronDown,
  GitBranch,
  Lightbulb,
  FolderOpen,
  Globe2,
  Sparkles,
  SlidersHorizontal,
  Square,
} from "@lucide/vue";
import {
  Badge,
  Button,
  Dropdown,
  Popover,
  Switch,
  Tooltip,
  message,
  type MenuProps,
} from "antdv-next";
import { computed, ref } from "vue";

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
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const toolsOpen = ref(false);
const voiceActive = ref(false);

// ============ 推荐提示词（深度思考位置） ============

const starterPromptItems: PromptsItemType[] = [
  {
    key: "ticket-branch",
    label: "生成工单分支",
    description: "填写工单 ID 和项目名称，生成 Git 分支",
  },
  {
    key: "placeholder-idea",
    label: "梳理一个想法",
    description: "快速整理目标、边界和下一步",
  },
  {
    key: "placeholder-review",
    label: "检查一段内容",
    description: "发现问题并给出简洁建议",
  },
];

// 真实发送的提示词文本，按 key 查表，避免污染 Prompts 项的 DOM 属性
const starterPromptText: Record<string, string> = {
  "ticket-branch": "请启动工单分支生成流程，先用表单收集工单 ID 和项目名称。",
  "placeholder-idea": "帮我把这个想法整理成目标、范围和下一步行动。",
  "placeholder-review": "帮我检查一段内容，指出最需要改进的三个地方。",
};

const handlePromptItemClick = (info: { data: { key: string | number } }) => {
  const key = String(info.data.key);
  const prompt = starterPromptText[key];
  if (prompt) emit("promptClick", { data: { key, description: prompt } });
};

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
  <section class="chat-footer" aria-label="消息输入区">
    <div v-if="showStarterPrompts && !loading" class="starter-prompts">
      <Prompts
        :items="starterPromptItems"
        class="starter-prompts-inner"
        @item-click="handlePromptItemClick"
      >
        <template #iconRender="{ item }">
          <GitBranch v-if="item.key === 'ticket-branch'" />
          <Lightbulb v-else-if="item.key === 'placeholder-idea'" />
          <Sparkles v-else />
        </template>
      </Prompts>
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
            <Popover v-model:open="toolsOpen" placement="topLeft" :arrow="false" trigger="click">
              <template #content>
                <div class="tools-menu">
                  <p>增强回答</p>
                  <button
                    v-if="props.searchAvailable"
                    type="button"
                    @click="emit('searchChange', !props.searchEnabled)"
                  >
                    <span><Globe2 /></span
                    ><span><strong>联网搜索</strong><small>查找并引用最新信息</small></span
                    ><Switch :checked="props.searchEnabled" size="small" />
                  </button>
                  <button type="button" @click="emit('thinkingChange', !thinkingEnabled)">
                    <span><BrainCircuit /></span
                    ><span><strong>深度思考</strong><small>为复杂问题投入更多时间</small></span
                    ><Switch :checked="thinkingEnabled" size="small" />
                  </button>
                  <button type="button" @click="emit('fileModeChange', !fileModeEnabled)">
                    <span><FolderOpen /></span
                    ><span><strong>文件</strong><small>生成可预览和下载的文件</small></span
                    ><Switch :checked="fileModeEnabled" size="small" />
                  </button>
                </div>
              </template>
              <Tooltip title="工具">
                <Badge :count="activeTools.length" :offset="[-4, 4]" class="tools-badge">
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
/* 工具按钮角标：count=0 时自动隐藏 */
.composer-tools :deep(.tools-badge) {
  display: inline-flex;
}
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
.starter-prompts {
  width: 100%;
  max-width: 780px;
  margin: 0 auto 7px;
}
.starter-prompts :deep(.antd-prompts) {
  width: 100%;
}
.starter-prompts :deep(.antd-prompts-list) {
  gap: 8px;
}
.starter-prompts :deep(.antd-prompts-item) {
  flex: 1 1 0;
  min-width: 0;
  min-height: 60px;
  padding: 10px 12px;
  border: 1px solid var(--brand-border);
  border-radius: 7px;
  background: var(--brand-surface);
  transition:
    background 160ms ease,
    border-color 160ms ease;
}
.starter-prompts :deep(.antd-prompts-item:hover) {
  background: var(--brand-surface-muted);
  border-color: var(--brand-border-strong);
}
.starter-prompts :deep(.antd-prompts-item:active) {
  background: var(--brand-surface-subtle);
}
.starter-prompts :deep(.antd-prompts-icon) {
  display: grid;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 5px;
  background: var(--brand-surface-subtle);
}
.starter-prompts :deep(.antd-prompts-icon svg) {
  width: 14px;
  height: 14px;
}
.starter-prompts :deep(.antd-prompts-content) {
  gap: 2px;
}
.starter-prompts :deep(.antd-prompts-label) {
  font-size: 11px;
  font-weight: 600;
  color: var(--brand-foreground);
}
.starter-prompts :deep(.antd-prompts-desc) {
  overflow: hidden;
  max-width: 100%;
  color: var(--brand-muted);
  font-size: 9px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.composer-tools :deep(.ant-btn[aria-expanded="true"]),
.composer-tools :deep(.ant-btn.tool-active) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
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
  .starter-prompts :deep(.antd-prompts-item) {
    flex: 0 0 auto;
    width: 196px;
  }
  .starter-prompts :deep(.antd-prompts-desc) {
    white-space: normal;
  }
}
</style>

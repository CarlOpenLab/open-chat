<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import { BrainCircuit, ChevronDown, Cpu, FolderOpen, Globe2, Square } from "@lucide/vue";
import { Dropdown, Tooltip, type MenuProps } from "antdv-next";
import { computed, ref, watch, type Component } from "vue";
import ModelIcon from "../Icons/ModelIcon.vue";

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
  assistantName?: string;
  /** 深度思考 chip 的图标，可配置（默认 BrainCircuit） */
  thinkingIcon?: Component;
  /** 联网搜索 chip 的图标，可配置（默认 Globe2） */
  searchIcon?: Component;
  /** 文件工作区 chip 的图标，可配置（默认 FolderOpen） */
  fileIcon?: Component;
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
  (e: "assistantSelect"): void;
}

const props = withDefaults(defineProps<Props>(), {
  // 组件本身就是函数，必须再包一层工厂，否则 Vue 会把默认值当作工厂函数调用
  thinkingIcon: () => BrainCircuit,
  searchIcon: () => Globe2,
  fileIcon: () => FolderOpen,
});
const emit = defineEmits<Emits>();

const modelMenu = computed<MenuProps>(() => ({
  items: props.modelItems,
  selectedKeys: [props.currentModel],
  onClick: ({ key }) => emit("modelChange", String(key)),
}));

/** 模型图标：只有确实认得的模型才用品牌图标，其余用通用字形，避免张冠李戴。 */
const brandedModel = computed(() => (/qwen/i.test(props.currentModel) ? "qwen" : ""));

/**
 * 推理强度：Waku 的「高」chip。底层仍是 useXChat 的 enable_thinking 布尔值，
 * 高/中映射为开启、低为关闭；本地记住具体档位以便再次展开时回显。
 */
type ReasoningLevel = "high" | "medium" | "low";

const REASONING_LABEL: Record<ReasoningLevel, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const reasoningLevel = ref<ReasoningLevel>(props.thinkingEnabled ? "high" : "low");

watch(
  () => props.thinkingEnabled,
  (enabled) => {
    // 父级把开关关掉时降到「低」；重新打开时恢复到上次的高/中档位
    if (!enabled) reasoningLevel.value = "low";
    else if (reasoningLevel.value === "low") reasoningLevel.value = "high";
  },
);

const reasoningMenu = computed<MenuProps>(() => ({
  items: (["high", "medium", "low"] as ReasoningLevel[]).map((level) => ({
    key: level,
    label: REASONING_LABEL[level],
  })),
  selectedKeys: [reasoningLevel.value],
  onClick: ({ key }) => {
    const level = String(key) as ReasoningLevel;
    reasoningLevel.value = level;
    emit("thinkingChange", level !== "low");
  },
}));

const handleChange = (value: string) => {
  emit("update:modelValue", value);
  emit("change", value);
};

const handleSubmit = (value: string) => {
  const prompt = value.trim();
  if (!prompt) return;
  emit("submit", prompt);
};

const chipClass = (active: boolean, disabled = false) => {
  if (disabled)
    return [
      "flex h-[26px] flex-none items-center gap-[6px] rounded-[6px] border-0 px-[8px] text-[11.5px] leading-[14px] bg-transparent text-brand-ghost opacity-55 cursor-not-allowed",
    ].join(" ");
  return [
    "flex h-[26px] flex-none items-center gap-[6px] rounded-[6px] border-0 px-[8px] text-[11.5px] leading-[14px] cursor-pointer transition-colors duration-150",
    active
      ? "bg-brand-surface-subtle text-brand-foreground"
      : "bg-transparent text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground",
  ].join(" ");
};
</script>

<template>
  <section
    class="chat-footer relative z-12 pt-[20px] px-[max(20px,calc((100%_-_720px)/2))] pb-[max(16px,env(safe-area-inset-bottom))] bg-[linear-gradient(to_bottom,transparent_0,var(--brand-workspace)_32px,var(--brand-workspace)_100%)] lt-md:px-[18px] lt-sm:px-[10px]"
    aria-label="消息输入区"
  >
    <Sender
      :value="modelValue"
      :loading="loading"
      placeholder="做什么都可以..."
      :on-cancel="() => emit('cancel')"
      :on-change="handleChange"
      :on-submit="handleSubmit"
      :suffix="false"
    >
      <template #footer="{ defaultNode }">
        <div class="flex min-h-[26px] w-full items-center justify-between gap-3">
          <!-- Waku composer 左排：能力 chips（深度思考 / 联网搜索 / 文件） -->
          <div class="flex min-w-0 items-center gap-[3px]">
            <Dropdown :menu="reasoningMenu" :trigger="['click']" placement="topLeft">
              <button
                type="button"
                :class="chipClass(thinkingEnabled)"
                :aria-label="`推理强度：${REASONING_LABEL[reasoningLevel]}`"
                title="推理强度"
              >
                <component
                  :is="props.thinkingIcon"
                  class="!h-[12px] !w-[12px] flex-none"
                  :class="thinkingEnabled ? 'text-brand-accent' : ''"
                />
                <span>深度思考</span>
                <span
                  v-if="thinkingEnabled"
                  class="rounded-[4px] bg-[color-mix(in_srgb,var(--brand-accent)_12%,transparent)] px-[4px] py-px text-[10px] font-600 leading-[12px] text-brand-accent"
                  >{{ REASONING_LABEL[reasoningLevel] }}</span
                >
                <ChevronDown class="!h-[10px] !w-[10px] flex-none text-brand-muted-strong" />
              </button>
            </Dropdown>
            <Tooltip :title="searchAvailable ? '联网搜索' : '当前模型不支持联网搜索'">
              <button
                type="button"
                :class="chipClass(searchEnabled, !searchAvailable)"
                :disabled="!searchAvailable"
                :aria-pressed="searchEnabled"
                aria-label="联网搜索"
                @click="emit('searchChange', !searchEnabled)"
              >
                <component
                  :is="props.searchIcon"
                  class="!h-[12px] !w-[12px] flex-none"
                  :class="searchEnabled ? 'text-brand-accent' : ''"
                />
                <span>联网搜索</span>
              </button>
            </Tooltip>
            <Tooltip v-if="fileModeEnabled" title="文件工作区">
              <button
                type="button"
                :class="chipClass(fileModeEnabled)"
                :aria-pressed="fileModeEnabled"
                aria-label="文件工作区"
                @click="emit('fileModeChange', !fileModeEnabled)"
              >
                <component
                  :is="props.fileIcon"
                  class="!h-[12px] !w-[12px] flex-none"
                  :class="fileModeEnabled ? 'text-brand-accent' : ''"
                />
                <span>文件</span>
              </button>
            </Tooltip>
          </div>

          <!-- Waku composer 右排：模型选择 + 发送 / 停止（圆形 26px，有内容时 inverse 填充） -->
          <div class="flex min-w-0 flex-none items-center gap-[6px]">
            <Dropdown :menu="modelMenu" :trigger="['click']" placement="topRight">
              <button
                type="button"
                :class="chipClass(false)"
                aria-label="选择模型"
                :title="assistantName ? `助手：${assistantName}` : undefined"
              >
                <ModelIcon v-if="brandedModel" :model="brandedModel" :size="13" />
                <Cpu v-else class="!h-[12px] !w-[12px] flex-none text-brand-muted-strong" />
                <span class="max-w-[180px] truncate lt-sm:max-w-[120px]">{{
                  currentModelLabel || "选择模型"
                }}</span>
                <ChevronDown class="!h-3 !w-3 flex-none text-brand-muted-strong" />
              </button>
            </Dropdown>
            <component v-if="!loading" :is="defaultNode" />
            <Tooltip v-else title="停止生成">
              <button
                type="button"
                class="grid h-[26px] w-[26px] place-items-center rounded-full border-0 bg-brand-surface-subtle p-0 text-brand-foreground cursor-pointer hover:bg-brand-danger-subtle"
                aria-label="停止生成"
                @click="emit('cancel')"
              >
                <Square class="!h-[11px] !w-[11px] fill-current" />
              </button>
            </Tooltip>
          </div>
        </div>
      </template>
    </Sender>
  </section>
</template>

<style scoped>
/* 保留原因：以下均为 :deep() 覆盖 antd / antd-x 内部类，按迁移规范保留在 scoped CSS 中 */
.chat-footer :deep(.antd-sender) {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
}
.chat-footer :deep(.antd-sender-main) {
  min-height: 96px;
  padding: 0;
  /* Waku composer 卡片：圆角 13px，border，composer 底色，无重阴影 */
  border: 1px solid var(--brand-border);
  border-radius: 13px;
  background: var(--brand-composer);
  /* Waku 的 composer 卡片没有投影，只有 1px border */
  box-shadow: none;
  transition: border-color 160ms ease;
}
.chat-footer :deep(.antd-sender-main:focus-within) {
  border-color: var(--brand-border-strong);
}
.chat-footer :deep(.antd-sender-content) {
  min-height: 50px;
  align-items: flex-start;
  padding: 10px 10px 2px;
}
.chat-footer :deep(.antd-sender-footer) {
  min-height: 32px;
  padding: 0 10px 10px;
}
.chat-footer :deep(textarea) {
  max-height: 152px;
  min-height: 36px;
  color: var(--brand-foreground);
  caret-color: var(--brand-accent);
  font-size: 13.5px;
  line-height: 21px;
}
.chat-footer :deep(textarea::placeholder) {
  color: var(--brand-muted-strong);
  opacity: 1;
}
/* Waku 发送按钮：圆形 26px，inverse 底色，无阴影 */
.chat-footer :deep(.antd-sender-actions-btn) {
  width: 26px;
  min-width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
  box-shadow: none;
}
.chat-footer :deep(.antd-sender-actions-btn:disabled) {
  background: var(--brand-sidebar-active);
  color: var(--brand-ghost);
  opacity: 1;
}
@media (max-width: 560px) {
  .chat-footer :deep(.antd-sender-main) {
    min-height: 102px;
    border-radius: 13px;
  }
  .chat-footer :deep(.antd-sender-content) {
    padding-inline: 12px;
  }
  .chat-footer :deep(.antd-sender-footer) {
    padding-inline: 8px;
  }
  .chat-footer :deep(textarea) {
    font-size: 16px;
  }
}
</style>

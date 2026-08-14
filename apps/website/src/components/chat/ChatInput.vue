<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  FolderOpen,
  Globe2,
  Square,
  SquareTerminal,
} from "@lucide/vue";
import { Dropdown, Tooltip, type MenuProps } from "antdv-next";
import { computed, h, ref, watch, type Component } from "vue";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import ModelIcon from "../Icons/ModelIcon.vue";

interface Props {
  modelValue: string;
  loading: boolean;
  currentModel: string;
  currentModelLabel?: string;
  /** 级联目录：供应商 → 模型列表 */
  modelCatalog: ModelCatalogEntry[];
  thinkingEnabled: boolean;
  fileModeEnabled: boolean;
  searchEnabled: boolean;
  searchAvailable: boolean;
  assistantName?: string;
  agentMode?: boolean;
  agentName?: string;
  agentAvailable?: boolean;
  agentProtocol?: string;
  agentConfiguring?: boolean;
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
  agentMode: false,
  agentName: "",
  agentAvailable: true,
  agentProtocol: "本地 CLI",
  agentConfiguring: false,
});
const emit = defineEmits<Emits>();

/** 让下拉菜单渲染在 .chat-app 内部，brand CSS 变量才能生效（antd 弹层默认挂到 body）。 */
const popupIntoChat = (trigger: HTMLElement) => trigger.closest(".chat-app") ?? document.body;

// ============ 模型选择（级联：供应商 → 模型） ============

/** 当前下拉所处层级：null = 供应商列表，否则为该供应商 id 的模型列表。 */
const cascadeProvider = ref<string | null>(null);

/** 模型下拉的展开状态。antdv Dropdown 默认点击任意菜单项即关闭，
 *  这里由外部控制，导航（供应商/返回）保持展开，选中模型才关闭。 */
const modelMenuOpen = ref(false);

/** 当前模型所属供应商 id（`provider/model` 取前段）。 */
const currentProviderKey = computed(() => {
  const model = props.currentModel;
  const index = model.indexOf("/");
  return index > 0 ? model.slice(0, index) : "";
});

/** 每次展开时回到供应商层；只有一个供应商时直接进入其模型列表。 */
const handleModelOpenChange = (open: boolean) => {
  if (open) {
    cascadeProvider.value =
      props.modelCatalog.length === 1 ? props.modelCatalog[0].providerId : null;
  }
};

/** 模型上下文窗口的展示文案：128000 → 128K，1000000 → 1M */
const formatContextLength = (length: number): string => {
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(length % 1_000_000 ? 1 : 0)}M`;
  if (length >= 1_000) return `${Math.round(length / 1_000)}K`;
  return String(length);
};

const modelMenu = computed<MenuProps>(() => {
  const provider = props.modelCatalog.find((item) => item.providerId === cascadeProvider.value);

  const items: NonNullable<MenuProps["items"]> = provider
    ? [
        {
          key: "__back",
          kind: "back",
          label: "全部供应商",
        },
        { type: "divider" },
        ...provider.models.map((model) => ({
          key: model.id,
          kind: "model",
          label: model.name || model.id,
          contextLength: model.contextLength,
        })),
      ]
    : props.modelCatalog.map((entry) => ({
        key: `provider:${entry.providerId}`,
        kind: "provider",
        label: entry.providerName,
        modelCount: entry.models.length,
      }));

  return {
    rootClass: "chat-model-menu",
    items,
    selectable: true,
    multiple: true,
    selectedKeys: provider ? [props.currentModel] : [currentProviderKey.value].filter(Boolean),
    labelRender: (item) => {
      if (item.type === "divider") return null;
      if (item.kind === "back") {
        return h("span", { class: "model-cascade-back" }, [
          h(ArrowLeft, { class: "model-cascade-back-icon" }),
          h("span", { class: "model-cascade-back-text" }, "全部供应商"),
        ]);
      }
      if (item.kind === "provider") {
        const selected = currentProviderKey.value === item.key;
        return h("span", { class: "model-provider-row" }, [
          h("span", { class: ["model-provider-name", { "is-selected": selected }] }, [
            String(item.label),
          ]),
          h("span", { class: "model-provider-count" }, String(item.modelCount ?? 0)),
          h(Check, { class: ["model-provider-check", { "is-visible": selected }] }),
          h(ChevronRight, { class: "model-provider-chevron" }),
        ]);
      }
      const selected = String(item.key) === props.currentModel;
      const contextLength =
        typeof item.contextLength === "number" && item.contextLength > 0
          ? formatContextLength(item.contextLength)
          : "";
      return h("span", { class: "model-menu-row" }, [
        h("span", { class: ["model-menu-name", { "is-selected": selected }] }, [
          String(item.label),
        ]),
        contextLength
          ? h("span", { class: "model-menu-ctx" }, contextLength)
          : h("span", { class: "model-menu-ctx model-menu-ctx-placeholder" }, "—"),
        h(Check, { class: ["model-menu-check", { "is-visible": selected }] }),
      ]);
    },
    onClick: ({ key }) => {
      const value = String(key);
      if (value === "__back") {
        cascadeProvider.value = null;
        return;
      }
      if (value.startsWith("provider:")) {
        cascadeProvider.value = value.slice("provider:".length);
        return;
      }
      modelMenuOpen.value = false;
      emit("modelChange", value);
    },
  };
});

/** 模型图标：只有确实认得的模型才用品牌图标，其余用通用字形，避免张冠李戴。 */
const brandedModel = computed(() => (/qwen/i.test(props.currentModel) ? "qwen" : ""));
const modelSelectionAvailable = computed(() =>
  props.modelCatalog.some((provider) => provider.models.length > 0),
);

// ============ 推理强度 ============

/**
 * 推理强度：分为高 / 中 / 低三档。底层仍是 useXChat 的 enable_thinking
 * 布尔值，高/中映射为开启、低为关闭；本地记住具体档位以便再次展开时回显。
 */
type ReasoningLevel = "high" | "medium" | "low";

const REASONING_LABEL: Record<ReasoningLevel, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const reasoningLevel = ref<ReasoningLevel>(props.thinkingEnabled ? "high" : "low");
/** 记住关闭前的档位：再次开启时恢复上次选择，而不是总是回到「高」 */
let lastEnabledLevel: ReasoningLevel = "high";

watch(
  () => props.thinkingEnabled,
  (enabled) => {
    if (enabled) {
      reasoningLevel.value = lastEnabledLevel;
    } else {
      if (reasoningLevel.value !== "low") lastEnabledLevel = reasoningLevel.value;
      reasoningLevel.value = "low";
    }
  },
);

/** 主按钮点击：直接开关深度思考 */
const handleThinkingToggle = () => {
  emit("thinkingChange", !props.thinkingEnabled);
};

const reasoningMenu = computed<MenuProps>(() => ({
  rootClass: "reasoning-level-menu",
  items: (["high", "medium", "low"] as ReasoningLevel[]).map((level) => ({
    key: level,
    label: REASONING_LABEL[level],
  })),
  selectedKeys: [reasoningLevel.value],
  labelRender: (item) =>
    h("span", { class: "reasoning-level-row" }, [
      h("span", { class: "reasoning-level-name" }, [String(item.label)]),
      item.key === reasoningLevel.value
        ? h(Check, { class: "reasoning-level-check" })
        : h("span", { class: "reasoning-level-check reasoning-level-check-blank" }),
    ]),
  onClick: ({ key }) => {
    const level = String(key) as ReasoningLevel;
    reasoningLevel.value = level;
    if (level !== "low") lastEnabledLevel = level;
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
    class="chat-footer relative z-12 pt-[20px] px-[max(20px,calc((100%_-_760px)/2))] pb-[max(16px,env(safe-area-inset-bottom))] bg-[linear-gradient(to_bottom,transparent_0,var(--brand-workspace)_32px,var(--brand-workspace)_100%)] lt-md:px-[18px] lt-sm:px-[10px]"
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
      :disabled="agentMode && (!agentAvailable || agentConfiguring)"
    >
      <template #footer="{ defaultNode }">
        <div class="flex min-h-[26px] w-full items-center justify-between gap-3">
          <!-- composer 左排：能力 chips（深度思考 / 联网搜索 / 文件） -->
          <div class="flex min-w-0 items-center gap-[3px]">
            <div
              class="reasoning-control flex h-[26px] flex-none items-center rounded-[6px]"
              :class="thinkingEnabled ? 'is-active' : ''"
            >
              <button
                type="button"
                class="reasoning-toggle"
                :aria-pressed="thinkingEnabled"
                aria-label="深度思考"
                title="深度思考"
                @click="handleThinkingToggle"
              >
                <component
                  :is="props.thinkingIcon"
                  class="!h-[12px] !w-[12px] flex-none"
                  :class="thinkingEnabled ? 'text-brand-accent' : ''"
                />
                <span>深度思考</span>
                <span v-if="thinkingEnabled" class="reasoning-level-badge">{{
                  REASONING_LABEL[reasoningLevel]
                }}</span>
              </button>
              <Dropdown
                :menu="reasoningMenu"
                :trigger="['click']"
                placement="topLeft"
                :get-popup-container="popupIntoChat"
              >
                <button
                  type="button"
                  class="reasoning-chevron"
                  :class="thinkingEnabled ? 'is-active' : ''"
                  aria-label="推理强度"
                  title="推理强度"
                >
                  <ChevronDown class="!h-[10px] !w-[10px] flex-none" />
                </button>
              </Dropdown>
            </div>
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

          <!-- composer 右排：模型选择（级联：供应商 → 模型）+ 发送 / 停止 -->
          <div class="flex min-w-0 flex-none items-center gap-[6px]">
            <Tooltip
              v-if="agentMode"
              :title="
                !agentAvailable
                  ? `${agentName} CLI 不可用，请检查本地安装与登录状态`
                  : agentConfiguring
                    ? `正在读取 ${agentName} 的模型配置`
                    : `${agentName} · ${agentProtocol}`
              "
            >
              <button
                type="button"
                :class="chipClass(false, !agentAvailable)"
                :aria-label="`当前 CLI Agent：${agentName}`"
              >
                <SquareTerminal class="!h-[12px] !w-[12px] flex-none text-brand-accent" />
                <span class="max-w-[110px] truncate lt-sm:hidden">{{ agentName }}</span>
                <span
                  class="h-[6px] w-[6px] rounded-full"
                  :class="agentAvailable ? 'bg-brand-success' : 'bg-brand-ghost'"
                />
              </button>
            </Tooltip>
            <Dropdown
              :menu="modelMenu"
              v-model:open="modelMenuOpen"
              :trigger="['click']"
              :disabled="!modelSelectionAvailable || agentConfiguring"
              placement="topRight"
              :get-popup-container="popupIntoChat"
              @open-change="handleModelOpenChange"
            >
              <button
                type="button"
                :class="chipClass(false, !modelSelectionAvailable || agentConfiguring)"
                :aria-disabled="!modelSelectionAvailable || agentConfiguring"
                :aria-label="
                  modelSelectionAvailable
                    ? '选择模型'
                    : agentMode
                      ? currentModelLabel
                      : '未配置模型'
                "
                :title="
                  !modelSelectionAvailable
                    ? agentMode
                      ? currentModelLabel
                      : '请先配置模型供应商'
                    : assistantName
                      ? `助手：${assistantName}`
                      : undefined
                "
              >
                <ModelIcon v-if="brandedModel" :model="brandedModel" :size="13" />
                <Cpu v-else class="!h-[12px] !w-[12px] flex-none text-brand-muted-strong" />
                <span class="max-w-[160px] truncate lt-sm:max-w-[92px]">{{
                  currentModelLabel || "选择模型"
                }}</span>
                <ChevronDown
                  v-if="modelSelectionAvailable"
                  class="!h-3 !w-3 flex-none text-brand-muted-strong"
                />
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
  max-width: 760px;
  margin: 0 auto;
}
.chat-footer :deep(.antd-sender-main) {
  min-height: 96px;
  padding: 0;
  /* composer 卡片：圆角 13px，border，composer 底色，无重阴影 */
  border: 1px solid var(--brand-border);
  border-radius: 13px;
  background: var(--brand-composer);
  /* composer 卡片没有投影，只有 1px border */
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
/* 发送按钮：圆形 26px，inverse 底色，无阴影 */
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

/* ============ 深度思考：主按钮切换 + 分档下拉 ============ */

.reasoning-control {
  transition:
    background 150ms ease,
    color 150ms ease;
}
.reasoning-control:hover,
.reasoning-control.is-active {
  background: var(--brand-surface-subtle);
}
.reasoning-toggle {
  display: flex;
  height: 100%;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  padding: 0 0 0 8px;
  color: var(--brand-muted);
  font-size: 11.5px;
  line-height: 14px;
  cursor: pointer;
  transition: color 150ms ease;
}
.reasoning-control:hover .reasoning-toggle,
.reasoning-control.is-active .reasoning-toggle {
  color: var(--brand-foreground);
}
.reasoning-level-badge {
  border-radius: 4px;
  background: color-mix(in srgb, var(--brand-accent) 12%, transparent);
  padding: 1px 4px;
  color: var(--brand-accent);
  font-size: 10px;
  font-weight: 600;
  line-height: 12px;
}
.reasoning-chevron {
  display: grid;
  width: 22px;
  height: 100%;
  flex: none;
  place-items: center;
  margin-left: 3px;
  border: 0;
  border-left: 1px solid transparent;
  border-radius: 0 6px 6px 0;
  background: transparent;
  color: var(--brand-muted-strong);
  cursor: pointer;
  transition:
    color 150ms ease,
    background 150ms ease;
}
.reasoning-chevron.is-active {
  border-left-color: var(--brand-border);
}
.reasoning-chevron:hover {
  background: color-mix(in srgb, var(--brand-surface-subtle) 80%, var(--brand-surface));
  color: var(--brand-foreground);
}

/* ============ 下拉弹层（getPopupContainer 挂到 .chat-app 内，brand 变量可用） ============ */

/* 模型级联菜单 */
:global(.chat-model-menu) {
  min-width: 240px;
  max-width: min(320px, calc(100vw - 32px));
  max-height: min(360px, 60vh);
  overflow-y: auto;
  padding: 6px;
}
:global(.chat-model-menu .ant-dropdown-menu-item) {
  padding: 5px 8px;
}
:global(.chat-model-menu .ant-dropdown-menu-item-selected) {
  background-color: transparent;
}
:global(.chat-model-menu .ant-dropdown-menu-item-divider) {
  margin: 4px 0;
}

/* 返回行（模型层顶部） */
:global(.model-cascade-back) {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--brand-muted-strong);
  font-size: 11px;
  font-weight: 600;
}
:global(.model-cascade-back-icon) {
  width: 12px;
  height: 12px;
}

/* 供应商行 */
:global(.model-provider-row) {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
:global(.model-provider-name) {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--brand-foreground);
  font-size: 12.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:global(.model-provider-name.is-selected) {
  color: var(--brand-accent);
}
:global(.model-provider-count) {
  flex: none;
  border-radius: 999px;
  background: var(--brand-surface-subtle);
  padding: 1px 6px;
  color: var(--brand-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 14px;
}
:global(.model-provider-check) {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--brand-accent);
  opacity: 0;
  transition: opacity 120ms ease;
}
:global(.model-provider-check.is-visible) {
  opacity: 1;
}
:global(.model-provider-chevron) {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--brand-ghost);
}

/* 模型行 */
:global(.model-menu-row) {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
:global(.model-menu-name) {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--brand-muted);
  font-size: 12px;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:global(.model-menu-name.is-selected) {
  color: var(--brand-foreground);
  font-weight: 600;
}
:global(.model-menu-ctx) {
  flex: none;
  color: var(--brand-ghost);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
:global(.model-menu-check) {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--brand-accent);
  opacity: 0;
  transition: opacity 120ms ease;
}
:global(.model-menu-check.is-visible) {
  opacity: 1;
}

/* 推理强度菜单 */
:global(.reasoning-level-menu) {
  min-width: 120px;
  padding: 4px;
}
:global(.reasoning-level-menu .ant-dropdown-menu-item) {
  padding: 4px 8px;
}
:global(.reasoning-level-row) {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}
:global(.reasoning-level-name) {
  min-width: 0;
  flex: 1;
  color: var(--brand-foreground);
  font-size: 12px;
}
:global(.reasoning-level-check) {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--brand-accent);
}
:global(.reasoning-level-check-blank) {
  opacity: 0;
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

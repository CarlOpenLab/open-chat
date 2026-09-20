<script setup lang="ts">
import { Check, ChevronDown, Cpu } from "@lucide/vue";
import { Dropdown, type MenuProps } from "antdv-next";
import { computed, h } from "vue";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import { createStyles } from "../../theme/antdvStyle";
import type { AccentGlobalToken } from "../../theme/shadcnTheme";
import ModelIcon from "../Icons/ModelIcon.vue";

/**
 * ModelPicker：Sender 底部的模型下拉（扁平按钮 + 供应商分组菜单）。
 *
 * 纯展示组件：当前模型 / 目录 / 展开状态经 props 传入，选中与开关状态经 emits 上抛；
 * 展开状态由父级持有（受控），字面量类名（sender-flat-btn / sender-flat-model-label）
 * 由壳层 SenderLayout 的样式锚定。
 */
interface Props {
  /** 当前模型 id（菜单选中项） */
  model: string;
  /** 当前模型展示名，空时回退为「选择模型」 */
  modelLabel?: string;
  /** 按供应商分组的模型目录 */
  modelCatalog?: ModelCatalogEntry[];
  /** Agent 会话：模型不可选时用模型名作为提示文案 */
  agentMode?: boolean;
  /** Agent 配置中：模型选择暂时禁用 */
  agentConfiguring?: boolean;
  /** 下拉是否展开（受控，配合 v-model:open） */
  open?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelLabel: "",
  modelCatalog: () => [],
  agentMode: false,
  agentConfiguring: false,
  open: false,
});

const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  (e: "select", key: string): void;
}>();

const useStyles = createStyles(({ token, css }) => {
  const accent = (token as AccentGlobalToken).colorAccent;
  return {
    textMutedStrong: css`
      color: ${token.colorTextTertiary};
    `,
    /* ===== 下拉弹层：弹层挂 body，样式以 rootClass（含本哈希类）为锚 ===== */
    chatModelMenu: css`
      min-width: 240px;
      max-width: min(320px, calc(100vw - 32px));
      max-height: min(360px, 60vh);
      overflow-y: auto;
      padding: 6px;

      .ant-dropdown-menu-item {
        padding: 5px 8px;
      }
      .ant-dropdown-menu-item-selected {
        background-color: transparent;
      }
      .ant-dropdown-menu-item-divider {
        margin: 4px 0;
      }
      .model-menu-row {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
      }
      .model-menu-copy {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-direction: column;
        gap: 1px;
      }
      .model-menu-name {
        min-width: 0;
        overflow: hidden;
        color: ${token.colorTextSecondary};
        font-size: 12px;
        font-weight: 400;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .model-menu-provider {
        overflow: hidden;
        color: ${token.colorTextQuaternary};
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .model-menu-name.is-selected {
        color: ${token.colorText};
        font-weight: 600;
      }
      .model-menu-ctx {
        flex: none;
        color: ${token.colorTextQuaternary};
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }
      .model-menu-check {
        width: 12px;
        height: 12px;
        flex: none;
        color: ${accent};
        opacity: 0;
        transition: opacity ${token.motionDurationMid} ${token.motionEaseInOut};
      }
      .model-menu-check.is-visible {
        opacity: 1;
      }
    `,
  };
});

const { styles, cx } = useStyles();

/** 受控展开状态：Dropdown 的 open 事件回抛给父级。 */
const menuOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

/** 模型图标：只有确实认得的模型才用品牌图标，其余用通用字形，避免张冠李戴。 */
const brandedModel = computed(() => (/qwen/i.test(props.model) ? "qwen" : ""));
const modelSelectionAvailable = computed(() =>
  props.modelCatalog.some((provider) => provider.models.length > 0),
);

/** 模型上下文窗口的展示文案：128000 → 128K，1000000 → 1M */
const formatContextLength = (length: number): string => {
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(length % 1_000_000 ? 1 : 0)}M`;
  if (length >= 1_000) return `${Math.round(length / 1_000)}K`;
  return String(length);
};

const modelMenu = computed<MenuProps>(() => {
  const items: NonNullable<MenuProps["items"]> = props.modelCatalog.flatMap((entry) =>
    entry.models.map((model) => ({
      key: model.id,
      kind: "model",
      label: model.name || model.id,
      providerName: entry.providerName,
      contextLength: model.contextLength,
    })),
  );

  return {
    rootClass: cx("chat-model-menu", styles.chatModelMenu),
    items,
    selectable: true,
    selectedKeys: [props.model],
    labelRender: (item) => {
      if (item.type === "divider") return null;
      const selected = String(item.key) === props.model;
      const contextLength =
        typeof item.contextLength === "number" && item.contextLength > 0
          ? formatContextLength(item.contextLength)
          : "";
      return h("span", { class: "model-menu-row" }, [
        h("span", { class: "model-menu-copy" }, [
          h("span", { class: ["model-menu-name", { "is-selected": selected }] }, [
            String(item.label),
          ]),
          h("span", { class: "model-menu-provider" }, String(item.providerName ?? "")),
        ]),
        contextLength ? h("span", { class: "model-menu-ctx" }, contextLength) : null,
        h(Check, { class: ["model-menu-check", { "is-visible": selected }] }),
      ]);
    },
    onClick: ({ key }) => {
      // 选中后收起下拉，再由父级处理模型切换
      emit("update:open", false);
      emit("select", String(key));
    },
  };
});
</script>

<template>
  <Dropdown
    v-model:open="menuOpen"
    :menu="modelMenu"
    :trigger="['click']"
    :disabled="!modelSelectionAvailable || agentConfiguring"
    placement="topRight"
  >
    <button
      type="button"
      class="sender-flat-btn sender-flat-btn-model"
      :class="{ 'is-disabled': !modelSelectionAvailable || agentConfiguring }"
      :disabled="!modelSelectionAvailable || agentConfiguring"
      :aria-disabled="!modelSelectionAvailable || agentConfiguring"
      :aria-label="modelSelectionAvailable ? '选择模型' : agentMode ? modelLabel : '未配置模型'"
      :title="
        !modelSelectionAvailable ? (agentMode ? modelLabel : '请先配置模型供应商') : undefined
      "
    >
      <ModelIcon v-if="brandedModel" :model="brandedModel" :size="13" />
      <Cpu v-else class="!h-[13px] !w-[13px] flex-none" :class="styles.textMutedStrong" />
      <span class="sender-flat-model-label">{{ modelLabel || "选择模型" }}</span>
      <ChevronDown
        v-if="modelSelectionAvailable"
        class="!h-3 !w-3 flex-none"
        :class="styles.textMutedStrong"
      />
    </button>
  </Dropdown>
</template>

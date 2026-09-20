<script setup lang="ts">
import {
  BrainCircuit,
  Check,
  ChevronDown,
  FolderOpen,
  Hammer,
  ImagePlus,
  ListTodo,
  ShieldCheck,
  Square,
} from "@lucide/vue";
import { Dropdown, Tooltip, type MenuProps } from "antdv-next";
import { computed, h, ref, type Component, type VNode } from "vue";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import { createStyles } from "../../theme/antdvStyle";
import type { AccentGlobalToken } from "../../theme/shadcnTheme";
import ModelPicker from "./ModelPicker.vue";

/**
 * SenderToolbar：Sender #footer 工具行（壳层 slot 内容）。
 *
 * 左排 = 附件 / 推理难度 / 权限策略 / 工作模式 / 文件工作区 chips + 运行状态文字，
 * 右排 = 模型选择（ModelPicker）+ 发送按钮（defaultNode，由 Sender 提供）+ 停止按钮。
 *
 * 纯展示组件：状态全部经 props 传入，交互意图经 emits 上抛；
 * 字面量类名（sender-footer-row / sender-footer-primary / sender-footer-secondary /
 * sender-stop-button）由壳层 SenderLayout 的样式锚定，移动内容时保持类名不变。
 */
type ReasoningLevel = "lowest" | "low" | "medium" | "high";

const REASONING_LABEL: Record<ReasoningLevel, string> = {
  lowest: "最低",
  low: "低",
  medium: "中",
  high: "高",
};

interface Props {
  /** 是否已有待发送附件（附件 chip 高亮） */
  hasAttachments?: boolean;
  /** 附件面板展开状态（chip 的 aria-expanded） */
  attachmentsPanelOpen?: boolean;
  /** 深度思考是否开启（推理 chip 高亮） */
  thinkingEnabled?: boolean;
  /** 推理难度档位（推理 chip 文案与菜单选中项） */
  reasoningLevel: ReasoningLevel;
  /** 深度思考 chip 的图标，可配置（默认 BrainCircuit） */
  thinkingIcon?: Component;
  /** 权限策略 */
  permission?: "supervised" | "auto" | "full";
  /** 权限被供应商锁定（chip 禁用，仅「完全访问」可选） */
  permissionLocked?: boolean;
  /** 工作模式 */
  mode?: "build" | "plan";
  /** 文件工作区是否开启（chip 仅在开启时展示，点击关闭） */
  fileModeEnabled?: boolean;
  /** 文件工作区 chip 的图标，可配置（默认 FolderOpen） */
  fileIcon?: Component;
  /** ACP 会话运行状态（running / requires_action / …），非 ACP 或空闲时为 null */
  runState?: string | null;
  /** 会话运行中（展示停止按钮） */
  loading?: boolean;
  /** 当前模型 id */
  model: string;
  /** 当前模型展示名 */
  modelLabel?: string;
  /** 按供应商分组的模型目录 */
  modelCatalog?: ModelCatalogEntry[];
  /** Agent 会话（模型不可选时用模型名作为提示文案） */
  agentMode?: boolean;
  /** Agent 配置中（模型选择暂时禁用） */
  agentConfiguring?: boolean;
  /** Sender 提供的发送按钮节点 */
  defaultNode?: VNode | null;
}

const props = withDefaults(defineProps<Props>(), {
  // 组件本身就是函数，必须再包一层工厂，否则 Vue 会把默认值当作工厂函数调用
  thinkingIcon: () => BrainCircuit,
  fileIcon: () => FolderOpen,
  hasAttachments: false,
  attachmentsPanelOpen: false,
  thinkingEnabled: false,
  permission: "supervised",
  permissionLocked: false,
  mode: "build",
  fileModeEnabled: false,
  runState: null,
  loading: false,
  modelLabel: "",
  modelCatalog: () => [],
  agentMode: false,
  agentConfiguring: false,
  defaultNode: null,
});

const emit = defineEmits<{
  /** 附件 chip：切换附件面板（业务侧负责面板可见性与焦点面板） */
  (e: "toggleAttachments"): void;
  (e: "reasoningLevelChange", level: ReasoningLevel): void;
  (e: "permissionChange", value: "supervised" | "auto" | "full"): void;
  (e: "modeChange", value: "build" | "plan"): void;
  (e: "fileModeChange", value: boolean): void;
  (e: "modelChange", key: string): void;
  (e: "cancel"): void;
}>();

const useStyles = createStyles(({ token, css }) => {
  const accent = (token as AccentGlobalToken).colorAccent;
  return {
    // Sender footer slot 最外层容器
    root: css`
      display: flex;
      width: 100%;
      flex-direction: column;
      gap: 8px;
    `,
    // footer chip（原 chipClass Tailwind 组合）
    chip: css`
      display: flex;
      height: 26px;
      flex: none;
      align-items: center;
      gap: 6px;
      border-radius: 6px;
      border: 0;
      padding: 0 8px;
      font-size: 11.5px;
      line-height: 14px;
      background: transparent;
      color: ${token.colorTextTertiary};
      cursor: pointer;
      transition:
        background ${token.motionDurationMid} ${token.motionEaseInOut},
        color ${token.motionDurationMid} ${token.motionEaseInOut};

      &:hover {
        background: ${token.colorFillTertiary};
        color: ${token.colorText};
      }
    `,
    chipActive: css`
      background: ${token.colorFillTertiary};
      color: ${token.colorText};
    `,
    chipDisabled: css`
      color: ${token.colorTextQuaternary};
      opacity: 0.55;
      cursor: not-allowed;

      &:hover {
        background: transparent;
        color: ${token.colorTextQuaternary};
      }
    `,
    textAccent: css`
      color: ${accent};
    `,
    textMutedStrong: css`
      color: ${token.colorTextTertiary};
    `,
    runState: css`
      margin-left: 6px;
      flex: none;
      font-size: 11px;
      line-height: 14px;
      color: ${token.colorTextTertiary};
    `,
    /* ===== 下拉弹层：弹层挂 body，样式以各自 rootClass（含本哈希类）为锚 ===== */
    senderOptionMenu: css`
      min-width: 132px;
      padding: 4px;

      .ant-dropdown-menu-item {
        padding: 5px 8px;
      }
      .permission-menu-copy {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 2px;
      }
      .permission-menu-label {
        color: ${token.colorText};
        font-size: 12px;
        font-weight: 500;
        line-height: 15px;
      }
      .permission-menu-description {
        max-width: 240px;
        color: ${token.colorTextTertiary};
        font-size: 10px;
        line-height: 14px;
        white-space: normal;
      }
    `,
    reasoningLevelMenu: css`
      min-width: 120px;
      padding: 4px;

      .ant-dropdown-menu-item {
        padding: 4px 8px;
      }
      .reasoning-level-row {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 10px;
      }
      .reasoning-level-name {
        min-width: 0;
        flex: 1;
        color: ${token.colorText};
        font-size: 12px;
      }
      .reasoning-level-check {
        width: 12px;
        height: 12px;
        flex: none;
        color: ${accent};
      }
      .reasoning-level-check-blank {
        opacity: 0;
      }
    `,
  };
});

const { styles, cx } = useStyles();

/** 模型下拉展开状态（纯 UI 状态，选中后收起）。 */
const modelMenuOpen = ref(false);

/** ACP 运行状态标签；idle 表示回合已结束（流即将关闭），无需提示。 */
const runStateLabel = computed(() => {
  switch (props.runState) {
    case "running":
      return "运行中…";
    case "requires_action":
      return "等待你的操作…";
    case "idle":
      return "";
    default:
      return props.runState ?? "";
  }
});

const reasoningMenu = computed<MenuProps>(() => ({
  rootClass: cx("reasoning-level-menu", styles.reasoningLevelMenu),
  items: (["lowest", "low", "medium", "high"] as ReasoningLevel[]).map((level) => ({
    key: level,
    label: REASONING_LABEL[level],
  })),
  selectedKeys: [props.reasoningLevel],
  labelRender: (item) =>
    h("span", { class: "reasoning-level-row" }, [
      h("span", { class: "reasoning-level-name" }, [String(item.label)]),
      item.key === props.reasoningLevel
        ? h(Check, { class: "reasoning-level-check" })
        : h("span", { class: "reasoning-level-check reasoning-level-check-blank" }),
    ]),
  onClick: ({ key }) => emit("reasoningLevelChange", String(key) as ReasoningLevel),
}));

const modeMenu = computed<MenuProps>(() => ({
  rootClass: cx("sender-option-menu", styles.senderOptionMenu),
  items: [
    { key: "build", label: "构建模式", icon: h(Hammer) },
    { key: "plan", label: "Plan 模式", icon: h(ListTodo) },
  ],
  selectedKeys: [props.mode],
  onClick: ({ key }) => emit("modeChange", String(key) as "build" | "plan"),
}));

const PERMISSION_OPTIONS = [
  {
    key: "supervised",
    label: "有监督",
    description: "执行命令或修改文件前先征求许可",
    icon: ShieldCheck,
  },
  {
    key: "auto",
    label: "自动",
    description: "常规操作自动处理，高风险操作仍会询问",
    icon: BrainCircuit,
  },
  {
    key: "full",
    label: "完全访问",
    description: "允许 Agent 直接执行操作",
    icon: ShieldCheck,
  },
] as const;

const permissionMenu = computed<MenuProps>(() => ({
  rootClass: cx("sender-option-menu", styles.senderOptionMenu),
  items: PERMISSION_OPTIONS.map((option) => ({
    key: option.key,
    disabled: props.permissionLocked && option.key !== "full",
    icon: h(option.icon),
    label: h("span", { class: "permission-menu-copy" }, [
      h("span", { class: "permission-menu-label" }, option.label),
      h("span", { class: "permission-menu-description" }, option.description),
    ]),
  })),
  selectedKeys: [props.permission],
  onClick: ({ key }) => emit("permissionChange", String(key) as "supervised" | "auto" | "full"),
}));

const chipClass = (active: boolean, disabled = false) => {
  if (disabled) return cx(styles.chip, styles.chipDisabled);
  return cx(styles.chip, active ? styles.chipActive : undefined);
};
</script>

<template>
  <div :class="styles.root">
    <div class="sender-footer-row">
      <!-- composer 左排：附件、推理、工作模式和文件工作区 -->
      <div class="sender-footer-primary">
        <Tooltip title="添加图片（支持粘贴 / 拖拽）">
          <button
            type="button"
            :class="chipClass(false)"
            aria-label="添加图片"
            :aria-expanded="attachmentsPanelOpen"
            @click="emit('toggleAttachments')"
          >
            <ImagePlus
              class="!h-[12px] !w-[12px] flex-none"
              :class="hasAttachments ? styles.textAccent : ''"
            />
          </button>
        </Tooltip>
        <Dropdown :menu="reasoningMenu" :trigger="['click']" placement="topLeft">
          <button
            type="button"
            :class="chipClass(thinkingEnabled)"
            aria-label="推理难度"
            title="推理难度"
          >
            <component
              :is="props.thinkingIcon"
              class="!h-[12px] !w-[12px] flex-none"
              :class="thinkingEnabled ? styles.textAccent : styles.textMutedStrong"
            />
            <span>{{ REASONING_LABEL[reasoningLevel] }}</span>
            <ChevronDown class="!h-3 !w-3 flex-none" :class="styles.textMutedStrong" />
          </button>
        </Dropdown>
        <Dropdown
          :menu="permissionMenu"
          :trigger="['click']"
          placement="topLeft"
          :disabled="permissionLocked"
        >
          <button
            type="button"
            :class="chipClass(true, permissionLocked)"
            aria-label="权限策略"
            :title="permissionLocked ? '该供应商固定为完全访问' : '权限策略'"
          >
            <ShieldCheck class="!h-[12px] !w-[12px] flex-none" :class="styles.textAccent" />
            <span>{{
              { supervised: "有监督", auto: "自动", full: "完全访问" }[props.permission]
            }}</span>
            <ChevronDown class="!h-3 !w-3 flex-none" :class="styles.textMutedStrong" />
          </button>
        </Dropdown>
        <Dropdown :menu="modeMenu" :trigger="['click']" placement="topLeft">
          <button type="button" :class="chipClass(props.mode === 'plan')" aria-label="工作模式">
            <ListTodo v-if="props.mode === 'plan'" class="!h-[12px] !w-[12px] flex-none" />
            <Hammer v-else class="!h-[12px] !w-[12px] flex-none" />
            <span>{{ props.mode === "plan" ? "Plan 模式" : "构建模式" }}</span>
            <ChevronDown class="!h-3 !w-3 flex-none" :class="styles.textMutedStrong" />
          </button>
        </Dropdown>
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
              :class="fileModeEnabled ? styles.textAccent : ''"
            />
            <span>文件</span>
          </button>
        </Tooltip>
        <span v-if="runStateLabel" :class="styles.runState">{{ runStateLabel }}</span>
      </div>

      <!-- composer 右排：模型选择（扁平按钮）+ 发送 + 独立停止会话 -->
      <div class="sender-footer-secondary">
        <ModelPicker
          v-model:open="modelMenuOpen"
          :model="model"
          :model-label="modelLabel"
          :model-catalog="modelCatalog"
          :agent-mode="agentMode"
          :agent-configuring="agentConfiguring"
          @select="(key) => emit('modelChange', key)"
        />
        <component :is="defaultNode" v-if="defaultNode" />
        <Tooltip v-if="loading" title="停止会话">
          <button
            type="button"
            class="sender-stop-button"
            aria-label="停止会话"
            title="停止会话，保留待发送队列"
            @click="emit('cancel')"
          >
            <Square class="!h-[11px] !w-[11px] fill-current" />
          </button>
        </Tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import type { SkillType } from "@antdv-next/x";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FolderOpen,
  GitBranch,
  Hammer,
  ImagePlus,
  ListTodo,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from "@lucide/vue";
import { Dropdown, Tooltip, type MenuProps } from "antdv-next";
import { computed, h, onBeforeUnmount, ref, watch, type Component } from "vue";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import type { StagedAttachment } from "../../composables/useComposerData";
import type { PermissionRequest } from "../../services/OpenChatProvider";
import type { GitWorkspaceInfo, SkillsIndex, UploadedAttachment } from "../../services/ai";
import type { QueuedChatMessage } from "../../services/chatStorage";
import { createStyles } from "../../theme/antdvStyle";
import type { AccentGlobalToken } from "../../theme/shadcnTheme";
import { normalizeDirectoryPath, uniqueDirectoryPaths } from "../../utils/projectPath";
import {
  filterSuggestionGroups,
  formatCommandForModel,
  formatSkillCommand,
  parseSenderCommand,
  skillCommandSyntax,
} from "../../utils/senderCommands";
import type { QuickCommandMeta, SenderSuggestion } from "../../utils/senderCommands";
import ModelIcon from "../Icons/ModelIcon.vue";
import AttachmentPanel from "./AttachmentPanel.vue";
import PermissionRequestPanel from "./PermissionRequestPanel.vue";
import QueuePanel from "./QueuePanel.vue";
import QuickCommands from "./QuickCommands.vue";

interface Props {
  modelValue: string;
  loading: boolean;
  disabled?: boolean;
  queuedMessages?: QueuedChatMessage[];
  queuePaused?: boolean;
  /** ACP 会话运行状态（running / requires_action / …），来自服务端 activeRuns；非 ACP 或空闲时为 null。 */
  runState?: string | null;
  currentModel: string;
  currentModelLabel?: string;
  /** 按供应商分组的模型目录 */
  modelCatalog: ModelCatalogEntry[];
  thinkingEnabled: boolean;
  fileModeEnabled: boolean;
  projectPath?: string;
  projectPathOptions?: string[];
  projectPathEnabled?: boolean;
  agentMode?: boolean;
  agentAvailable?: boolean;
  agentConfiguring?: boolean;
  mode?: "build" | "plan";
  permission?: "supervised" | "auto" | "full";
  permissionLocked?: boolean;
  pendingPermission?: PermissionRequest | null;
  /** 是否为 Oh My Pi（pi/omp）会话，快捷指令优先展示 Goal/Review */
  isOhMyPi?: boolean;
  /** 当前 CLI agent id：决定 skill 唤起写法（codex `$name` / pi、omp `/skill:name` / 其余 `/name`） */
  agentId?: string;
  /** 深度思考 chip 的图标，可配置（默认 BrainCircuit） */
  thinkingIcon?: Component;
  /** 文件工作区 chip 的图标，可配置（默认 FolderOpen） */
  fileIcon?: Component;
  // ===== 受控业务数据（由 useComposerData 提供，组件只读） =====
  /** Git 工作区状态；null 表示非仓库或未加载 */
  gitWorkspace?: GitWorkspaceInfo | null;
  /** 分支切换进行中 */
  gitBusy?: boolean;
  /** 系统目录选择器进行中 */
  projectPathPicking?: boolean;
  /** 斜杠建议数据源（项目 / 全局 skills），拉取失败时业务侧静默降级为空 */
  skills?: SkillsIndex;
  /** 待发送附件（v-model），上传副作用经 attachmentsUpload 事件上抛 */
  attachments?: StagedAttachment[];
}

interface Emits {
  (e: "update:modelValue", value: string): void;
  (e: "change", value: string): void;
  (e: "cancel"): void;
  (
    e: "submit",
    value: string,
    attachments: UploadedAttachment[],
    commandMeta?: { command: string; rawGoal: string },
  ): void;
  (e: "queuedMessageChange", id: string, content: string): void;
  (e: "queuedMessageRemove", id: string): void;
  (e: "queuedMessageClear"): void;
  (e: "queuedMessageSend"): void;
  (e: "modelChange", key: string): void;
  (e: "thinkingChange", value: boolean): void;
  (e: "fileModeChange", value: boolean): void;
  (e: "projectPathChange", value: string): void;
  (e: "projectPathRemove", value: string): void;
  (e: "modeChange", value: "build" | "plan"): void;
  (e: "permissionChange", value: "supervised" | "auto" | "full"): void;
  (e: "permissionResponse", value: "once" | "always" | "reject"): void;
  // ===== 副作用意图（业务侧 useComposerData 承接） =====
  (e: "pickProjectPath"): void;
  /** Git 菜单打开等 UI 时机的刷新请求（watch 驱动的刷新在业务侧） */
  (e: "gitWorkspaceRefresh"): void;
  (e: "gitBranchSwitch", branch: string): void;
  /** 粘贴 / 拖拽 / 文件选择三入口汇总的待上传文件 */
  (e: "attachmentsUpload", files: File[]): void;
  (e: "update:attachments", value: StagedAttachment[]): void;
}

const props = withDefaults(defineProps<Props>(), {
  // 组件本身就是函数，必须再包一层工厂，否则 Vue 会把默认值当作工厂函数调用
  thinkingIcon: () => BrainCircuit,
  fileIcon: () => FolderOpen,
  agentMode: false,
  agentAvailable: true,
  agentConfiguring: false,
  disabled: false,
  queuedMessages: () => [],
  queuePaused: false,
  runState: null,
  mode: "build",
  permission: "supervised",
  permissionLocked: false,
  pendingPermission: null,
  projectPath: "",
  projectPathOptions: () => [],
  projectPathEnabled: false,
  isOhMyPi: false,
  agentId: "",
  gitWorkspace: null,
  gitBusy: false,
  projectPathPicking: false,
  skills: () => ({ project: [], global: [] }),
  attachments: () => [],
});
const emit = defineEmits<Emits>();

const useStyles = createStyles(({ token, css }) => {
  const accent = (token as AccentGlobalToken).colorAccent;
  return {
    // composer 外壳：原 Tailwind 类（z-12 / px max 内边距 / 底部渐变） + 全部壳层样式。
    // 子元素沿用字面量类名作为选择器锚点，antdv / antdv-x 内部类同理（替代 :deep）。
    chatFooter: css`
      position: relative;
      z-index: 12;
      padding: 20px max(20px, calc((100% - 760px) / 2)) max(16px, env(safe-area-inset-bottom));
      background: linear-gradient(
        to bottom,
        transparent 0,
        ${token.colorBgLayout} 32px,
        ${token.colorBgLayout} 100%
      );

      /* 对齐 uno.config.ts 的自定义断点：lt-md => max-width 820px，lt-sm => max-width 560px */
      @media (max-width: 820px) {
        padding-left: 18px;
        padding-right: 18px;
      }
      @media (max-width: 560px) {
        padding-left: 10px;
        padding-right: 10px;
      }

      /* wrapper：浮层、Sender、底部卡片的共同定位锚点（max-width 760px 与 chat-footer 横向 padding 对齐） */
      .sender-stack {
        position: relative;
        z-index: 3;
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
      }
      /* 浮层：绝对定位锚定 wrapper 顶部（= Sender 顶），底部 28px 探入 Sender，
       * 被 z-index 更高的 .antd-sender-main 盖住一点，形成悬浮叠压感。
       * 偏移量只跟 wrapper 走，外层布局调整不会改变悬浮位置。 */
      .sender-header-card {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 100%;
        margin-bottom: -28px;
        z-index: 2;
        max-height: 360px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 1px solid ${token.colorBorderSecondary};
        border-radius: 16px;
        background: ${token.colorBgContainer};
        padding: 8px 8px 36px;
        box-shadow: ${token.boxShadowSecondary};
      }
      .sender-header-enter-active,
      .sender-header-leave-active {
        max-height: 360px;
        overflow: hidden;
        transition:
          max-height ${token.motionDurationMid} ${token.motionEaseInOut},
          margin-bottom ${token.motionDurationMid} ${token.motionEaseInOut},
          opacity ${token.motionDurationMid} ${token.motionEaseInOut},
          transform ${token.motionDurationMid} ${token.motionEaseInOut},
          padding ${token.motionDurationMid} ${token.motionEaseInOut};
        transform-origin: bottom center;
      }
      .sender-header-enter-from,
      .sender-header-leave-to {
        max-height: 0;
        margin-bottom: 0;
        border-color: transparent;
        opacity: 0;
        padding-top: 0;
        padding-bottom: 0;
      }
      .sender-header-card.has-permission {
        border-color: ${token.colorWarningBorder};
      }
      .sender-header-card.has-suggestion {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        overflow: visible;
        max-height: none;
        /* 指令候选列表要完整浮在输入框上方，不能被 Sender 盖住 */
        z-index: 4;
      }
      .sender-header-card.has-suggestion .sender-header-panel {
        overflow: visible;
      }
      .sender-header-panel {
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
      }
      .sender-header-card.has-navigation {
        /* 基础卡是 column，多面板导航时左右箭头必须切成 row，
         * 否则箭头会堆叠在内容上下并把卡片撑成三倍高 */
        flex-direction: row;
        align-items: center;
        gap: 4px;
      }
      .sender-header-nav {
        display: grid;
        width: 26px;
        height: 34px;
        flex: none;
        place-items: center;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: ${token.colorTextTertiary};
        cursor: pointer;
      }
      .sender-header-nav:hover {
        background: ${token.colorFillTertiary};
        color: ${token.colorText};
      }
      .sender-header-nav-icon {
        width: 16px;
        height: 16px;
      }
      .sender-header-card:not(.has-navigation) .sender-header-panel {
        width: 100%;
      }
      .sender-header-card.has-navigation .sender-header-panel {
        flex: 1;
        min-width: 0;
      }

      /* ===== Sender（antdv-x）内部结构覆写（原 scoped :deep 规则） ===== */
      .antd-sender {
        position: relative;
        z-index: 3;
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
      }
      .antd-sender-main {
        position: relative;
        z-index: 3;
        min-height: 96px;
        padding: 0;
        /* composer 卡片：圆角 13px，border，composer 底色，无重阴影 */
        border: 1px solid ${token.colorBorderSecondary};
        border-radius: 13px;
        background: ${token.colorBgContainer};
        /* composer 卡片没有投影，只有 1px border */
        box-shadow: none;
        transition: border-color ${token.motionDurationMid} ${token.motionEaseInOut};
      }
      /* 有底部卡片时，输入卡片去掉下边框和下圆角，两段视觉连成一张卡片 */
      &.has-bottom-card .antd-sender-main {
        border-radius: 13px;
      }
      .antd-sender-main:focus-within {
        border-color: ${token.colorBorder};
      }
      .antd-sender-content {
        min-height: 50px;
        align-items: flex-start;
        padding: 10px 10px 2px;
      }
      .antd-sender-footer {
        min-height: 32px;
        padding: 0 10px 10px;
      }
      textarea {
        max-height: 152px;
        min-height: 36px;
        color: ${token.colorText};
        caret-color: ${accent};
        font-size: 13.5px;
        line-height: 21px;
      }
      textarea::placeholder {
        color: ${token.colorTextTertiary};
        opacity: 1;
      }
      /* 发送按钮：圆形 26px，inverse 底色，无阴影 */
      .antd-sender-actions-btn {
        width: 26px;
        min-width: 26px;
        height: 26px;
        border-radius: 50%;
        background: ${token.colorText};
        color: ${token.colorBgContainer};
        box-shadow: none;
      }
      .antd-sender-actions-btn:disabled {
        background: ${token.colorFill};
        color: ${token.colorTextDisabled};
        opacity: 1;
      }

      /* sender 底部卡片：与上方输入卡片同背景（header slot 背景），底部圆角 */
      .sender-bottom-card {
        position: relative;
        z-index: 2;
        width: 100%;
        max-width: 760px;
        min-height: 42px;
        margin: 0 auto;
        border: 1px solid ${token.colorBorderSecondary};
        border-top: 0;
        border-radius: 0 0 13px 13px;
        background: ${token.colorBgContainer};
        padding: 12px 8px 8px;
        box-shadow: none;
        margin-top: -8px;
      }
      .sender-bottom-row {
        display: flex;
        min-height: 24px;
        align-items: center;
        gap: 2px;
      }
      /* 扁平按钮（去 tag）：模型 / 项目目录 / Git 分支共用 */
      .sender-flat-btn {
        display: flex;
        height: 24px;
        min-width: 0;
        flex: none;
        align-items: center;
        gap: 6px;
        border: 0;
        border-radius: 7px;
        padding: 0 8px;
        background: transparent;
        color: ${token.colorTextTertiary};
        font-size: 12.5px;
        line-height: 16px;
        cursor: pointer;
        transition:
          background ${token.motionDurationMid} ${token.motionEaseInOut},
          color ${token.motionDurationMid} ${token.motionEaseInOut};
      }
      .sender-flat-btn:hover:not(:disabled) {
        background: ${token.colorFillTertiary};
        color: ${token.colorText};
      }
      .sender-flat-btn:focus-visible {
        outline: 2px solid ${token.controlOutline};
        outline-offset: 1px;
      }
      .sender-flat-btn.is-disabled,
      .sender-flat-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      /* 模型作为主标题，比其余项更醒目 */
      .sender-flat-btn-model {
        color: ${token.colorText};
        font-weight: 500;
      }
      .sender-flat-model-label,
      .sender-flat-label {
        display: block;
        min-width: 0;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sender-flat-model-label {
        max-width: 220px;
      }
      .sender-flat-sep {
        width: 1px;
        height: 16px;
        flex: none;
        margin: 0 4px;
        background: ${token.colorBorderSecondary};
      }
      .sender-flat-project {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 1px;
      }
      .sender-flat-clear {
        display: grid;
        width: 26px;
        height: 26px;
        flex: none;
        place-items: center;
        border: 0;
        border-radius: 6px;
        padding: 0;
        background: transparent;
        color: ${token.colorTextTertiary};
        cursor: pointer;
      }
      .sender-flat-clear:hover:not(:disabled) {
        background: ${token.colorFillTertiary};
        color: ${token.colorText};
      }
      .sender-flat-clear:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }

      .sender-footer-row {
        display: flex;
        width: 100%;
        min-height: 26px;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .sender-footer-primary,
      .sender-footer-secondary {
        display: flex;
        min-width: 0;
        align-items: center;
      }
      .sender-footer-primary {
        gap: 3px;
      }
      .sender-footer-secondary {
        flex: none;
        gap: 6px;
      }
      .sender-stop-button {
        display: grid;
        width: 28px;
        height: 28px;
        flex: none;
        place-items: center;
        border: 1px solid ${token.colorError};
        border-radius: 7px;
        padding: 0;
        background: color-mix(in srgb, ${token.colorError} 10%, transparent);
        color: ${token.colorError};
        cursor: pointer;
        transition:
          background ${token.motionDurationMid} ${token.motionEaseInOut},
          color ${token.motionDurationMid} ${token.motionEaseInOut};
      }
      .sender-stop-button:hover {
        background: ${token.colorError};
        color: ${token.colorBgLayout};
      }

      .drop-overlay {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 600;
        color: ${accent};
        background: color-mix(in srgb, ${token.colorBgLayout} 82%, transparent);
        border: 1.5px dashed ${accent};
        border-radius: 13px;
        pointer-events: none;
      }

      @media (max-width: 560px) {
        .antd-sender-main {
          min-height: 102px;
          border-radius: 13px;
        }
        &.has-bottom-card .antd-sender-main {
          border-radius: 13px 13px 0 0;
        }
        .sender-bottom-card {
          min-height: auto;
        }
        .sender-bottom-row {
          flex-wrap: wrap;
          gap: 2px 4px;
          padding: 2px 0;
        }
        .antd-sender-content {
          padding-inline: 12px;
        }
        .antd-sender-footer {
          padding-inline: 8px;
        }
        textarea {
          font-size: 16px;
        }
        .sender-footer-row {
          flex-wrap: wrap;
          gap: 4px 8px;
        }
        .sender-footer-primary {
          width: 100%;
        }
        .sender-footer-secondary {
          margin-left: auto;
        }
      }
    `,
    // Sender footer slot 最外层容器（原 Tailwind flex w-full flex-col gap-2）
    footerCol: css`
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
    projectPathMenu: css`
      min-width: 260px;
      max-width: min(380px, calc(100vw - 32px));
      max-height: min(360px, 60vh);
      overflow-y: auto;
      padding: 6px;

      .ant-dropdown-menu-item-content {
        min-width: 0;
      }
      .ant-dropdown-menu-item-divider {
        margin: 4px 0;
      }
      .project-path-menu-row {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
        padding-left: 4px;
      }
      .project-path-menu-copy {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-direction: column;
        gap: 1px;
      }
      .project-path-menu-name,
      .project-path-menu-location {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .project-path-menu-name {
        color: ${token.colorText};
        font-size: 12px;
        line-height: 16px;
      }
      .project-path-menu-location {
        color: ${token.colorTextTertiary};
        font-size: 10.5px;
        line-height: 14px;
      }
      .project-path-menu-remove {
        display: grid;
        width: 26px;
        height: 26px;
        flex: none;
        place-items: center;
        border: 0;
        border-radius: 5px;
        padding: 0;
        background: transparent;
        color: ${token.colorTextTertiary};
        cursor: pointer;
      }
      .project-path-menu-remove:hover,
      .project-path-menu-remove:focus-visible {
        background: ${token.colorErrorBg};
        color: ${token.colorError};
        outline: none;
      }
      .project-path-menu-name.is-selected {
        color: ${token.colorText};
        font-weight: 600;
      }
      .project-path-menu-check {
        width: 12px;
        height: 12px;
        flex: none;
        color: ${accent};
        opacity: 0;
        transition: opacity ${token.motionDurationMid} ${token.motionEaseInOut};
      }
      .project-path-menu-check.is-visible {
        opacity: 1;
      }
      .project-path-menu-empty {
        display: block;
        padding: 4px 8px;
        color: ${token.colorTextQuaternary};
        font-size: 12px;
      }
    `,
    gitBranchMenu: css`
      min-width: 180px;
      max-width: min(320px, calc(100vw - 32px));
      max-height: min(360px, 60vh);
      overflow-y: auto;
      padding: 6px;

      .ant-dropdown-menu-item-content {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
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

const pathName = (path: string): string => {
  const normalized = normalizeDirectoryPath(path);
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
};

const projectPathName = computed(() => pathName(String(props.projectPath || "")));

const projectPathMenu = computed<MenuProps>(() => {
  const paths = uniqueDirectoryPaths(props.projectPathOptions);
  const currentPath = normalizeDirectoryPath(props.projectPath);
  const currentIndex = paths.indexOf(currentPath);
  const hasSelection = currentIndex >= 0;

  const pathItems: NonNullable<MenuProps["items"]> = paths.map((path, index) => ({
    key: `__path_${index}__`,
    label: path,
    // store raw path for labelRender
    path,
  }));

  const emptyHint: NonNullable<MenuProps["items"]> =
    paths.length === 0 ? [{ key: "__empty__", label: "暂无历史目录", disabled: true }] : [];

  const clearItem: NonNullable<MenuProps["items"]> = hasSelection
    ? [{ key: "__none__", label: "清除已选目录", icon: h(X) }]
    : [];

  const items: NonNullable<MenuProps["items"]> = [
    ...pathItems,
    ...emptyHint,
    ...(pathItems.length > 0 || emptyHint.length > 0 ? [{ type: "divider" as const }] : []),
    ...clearItem,
    { key: "__pick__", label: "选择其他目录", icon: h(FolderOpen) },
  ];

  return {
    rootClass: cx("project-path-menu", styles.projectPathMenu),
    items,
    selectable: true,
    selectedKeys: hasSelection ? [`__path_${currentIndex}__`] : [],
    labelRender: (item) => {
      if (item.type === "divider") return null;
      if (String(item.key).startsWith("__path_")) {
        const match = String(item.key).match(/^__path_(\d+)__$/);
        const idx = match ? Number(match[1]) : -1;
        const path = idx >= 0 ? paths[idx] : "";
        if (!path) return h("span", null, String(item.label ?? ""));
        const selected = idx === currentIndex;
        return h("div", { class: "project-path-menu-row", title: path }, [
          h(Check, {
            class: ["project-path-menu-check", { "is-visible": selected }],
            size: 14,
            "aria-hidden": "true",
          }),
          h("span", { class: "project-path-menu-copy" }, [
            h(
              "span",
              { class: ["project-path-menu-name", { "is-selected": selected }] },
              pathName(path) || "未命名目录",
            ),
            h("span", { class: "project-path-menu-location" }, path),
          ]),
          h(
            "button",
            {
              type: "button",
              class: "project-path-menu-remove",
              title: "从列表移除",
              "aria-label": `从列表移除 ${path}`,
              onClick: (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                emit("projectPathRemove", path);
              },
            },
            [h(Trash2, { size: 14, "aria-hidden": "true" })],
          ),
        ]);
      }
      if (item.key === "__empty__") {
        return h("span", { class: "project-path-menu-empty" }, String(item.label));
      }
      return null;
    },
    onClick: ({ key }) => {
      if (key === "__none__") {
        emit("projectPathChange", "");
        return;
      }
      if (key === "__pick__") {
        void pickProjectPath();
        return;
      }
      const match = String(key).match(/^__path_(\d+)__$/);
      const selected = match ? paths[Number(match[1])] : undefined;
      if (selected) emit("projectPathChange", selected);
    },
  };
});

const clearProjectPath = () => {
  emit("projectPathChange", "");
};

/** 目录选择器：副作用在业务侧（useComposerData.handlePickProjectPath）。 */
const pickProjectPath = () => emit("pickProjectPath");

const gitBranchLabel = computed(() => {
  if (props.gitBusy) return "切换中...";
  if (props.gitWorkspace?.currentBranch) {
    return `${props.gitWorkspace.currentBranch}${props.gitWorkspace.dirty ? " *" : ""}`;
  }
  return props.gitWorkspace?.detached ? "detached HEAD" : "Git 分支";
});

const gitBranchMenu = computed<MenuProps>(() => ({
  rootClass: cx("git-branch-menu", styles.gitBranchMenu),
  items: (props.gitWorkspace?.branches ?? []).map((branch) => ({
    key: branch,
    label: branch,
    icon: branch === props.gitWorkspace?.currentBranch ? h(Check) : undefined,
  })),
  selectable: true,
  selectedKeys: props.gitWorkspace?.currentBranch ? [props.gitWorkspace.currentBranch] : [],
  onClick: ({ key }) => emit("gitBranchSwitch", String(key)),
}));

/** Git 菜单展开时请求刷新工作区（watch 驱动的刷新在业务侧）。 */
const handleGitMenuOpen = (open: boolean) => {
  if (open && !props.loading && props.projectPath.trim()) emit("gitWorkspaceRefresh");
};

// ============ 模型选择（直接选择模型） ============

const modelMenuOpen = ref(false);

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
    selectedKeys: [props.currentModel],
    labelRender: (item) => {
      if (item.type === "divider") return null;
      const selected = String(item.key) === props.currentModel;
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
      const value = String(key);
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
/** 输入区底部卡片：有项目目录 / Git 分支上下文时展示（与上方输入卡片连成一张卡片）。 */
const showBottomCard = computed(() => props.projectPathEnabled);

// ============ 推理强度 / 工作模式 / 权限 ============

type ReasoningLevel = "lowest" | "low" | "medium" | "high";

const REASONING_LABEL: Record<ReasoningLevel, string> = {
  lowest: "最低",
  high: "高",
  medium: "中",
  low: "低",
};

const reasoningLevel = ref<ReasoningLevel>(props.thinkingEnabled ? "high" : "lowest");

watch(
  () => props.thinkingEnabled,
  (enabled) => {
    if (enabled) {
      if (reasoningLevel.value === "lowest") reasoningLevel.value = "high";
    } else {
      reasoningLevel.value = "lowest";
    }
  },
);

const reasoningMenu = computed<MenuProps>(() => ({
  rootClass: cx("reasoning-level-menu", styles.reasoningLevelMenu),
  items: (["lowest", "low", "medium", "high"] as ReasoningLevel[]).map((level) => ({
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
    emit("thinkingChange", level !== "lowest");
  },
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

// ============ Skill：Goal / Review 由 Sender 原生 skill 承载，凸显为 tag 且随消息透传 ============
const activeSkill = ref<SkillType | undefined>(undefined);
/**
 * activeSkill 为 skill 类 tag 时记录真实 skill 名（goal/review 走 value 判断不需要），
 * 提交时还原为 "/name 参数" 文本交给 agent CLI 解析。
 */
const activeSkillName = ref<string | null>(null);

/** 当前 CLI 的 skill 唤起语法：选中 tag 与提交文本都按它还原，避免 codex 收到 "/name"。 */
const skillSyntax = computed(() => skillCommandSyntax(props.agentId, Boolean(props.isOhMyPi)));

/** 同步 Sender 的 slot 文本与外部 modelValue，避免 ProseMirror 侧残留 "/"（tag + / 问题）。 */
const senderSlotConfig = computed(() => {
  if (!activeSkill.value) return undefined;
  const text = props.modelValue ?? "";
  if (!text) return [];
  return [{ type: "text" as const, value: text }];
});

// ============ "/" suggestion：内置指令 + 项目 / 全局 Skills ============
// skills 是受控 prop（业务侧 useComposerData 拉取，失败静默降级为空），组件只消费。

/** 斜杠后的过滤词（首个空白前的 token）。 */
const slashQuery = computed(() => {
  const trimmed = props.modelValue.trimStart();
  if (!trimmed.startsWith("/")) return "";
  return trimmed.slice(1).split(/\s/)[0] ?? "";
});

/** Esc 关闭面板后记录关闭时的过滤词；输入继续变化（换词 / 退回 "/"）才重新允许弹出。 */
const suggestionDismissedAtQuery = ref<string | null>(null);

watch(slashQuery, (query) => {
  if (suggestionDismissedAtQuery.value !== null && query !== suggestionDismissedAtQuery.value) {
    suggestionDismissedAtQuery.value = null;
  }
});

const dismissSuggestion = () => {
  suggestionDismissedAtQuery.value = slashQuery.value;
};

const hasSuggestion = computed(() => {
  if (suggestionDismissedAtQuery.value !== null) return false;
  const trimmed = props.modelValue.trimStart();
  if (!trimmed.startsWith("/")) return false;
  const flat = filterSuggestionGroups(
    slashQuery.value,
    props.skills,
    Boolean(props.isOhMyPi),
  ).flatMap((group) => group.items);
  // 已输入空格且候选都是精确匹配：视为指令已敲定，收起面板让位给参数输入
  if (
    trimmed.includes(" ") &&
    flat.length > 0 &&
    flat.every((item) => item.name.toLowerCase() === slashQuery.value.toLowerCase())
  ) {
    return false;
  }
  return flat.length > 0;
});

// ============ 快捷指令组件（斜杠触发，含项目 / 全局 skills） ============
const quickCommandsRef = ref<InstanceType<typeof QuickCommands> | null>(null);
const senderRef = ref<InstanceType<typeof Sender> | null>(null);

const COMMAND_TITLES: Record<QuickCommandMeta["command"], string> = {
  goal: "🎯 Goal",
  review: "🔍 Review",
  instruction: "📋 Instruction",
  system: "⚙️ System",
};

const handleSuggestionSelect = (item: SenderSuggestion, remaining: string) => {
  if (item.kind === "command") {
    activeSkill.value = {
      value: item.command,
      title: COMMAND_TITLES[item.command],
      closable: { disabled: false },
    };
    const nextValue = remaining.trim();
    emit("update:modelValue", nextValue);
    emit("change", nextValue);
  } else {
    // skill 选中后凸显为可关闭的 Sender tag，正文只留参数；提交时还原为当前 CLI 的唤起写法
    activeSkill.value = {
      value: `skill:${item.name}`,
      title: `🧩 ${formatSkillCommand(skillSyntax.value, item.name)}`,
      closable: { disabled: false },
    };
    activeSkillName.value = item.name;
    const nextValue = remaining.trim();
    emit("update:modelValue", nextValue);
    emit("change", nextValue);
  }
  suggestionDismissedAtQuery.value = null;
  setTimeout(() => {
    (senderRef.value as unknown as { focus?: () => void })?.focus?.();
  }, 0);
};

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

const handleChange = (
  value: string,
  _event?: Event,
  _slotConfig?: unknown[],
  skill?: SkillType,
) => {
  // SlotTextArea 模式（已激活 skill）：ProseMirror 侧通过 slotConfig/skill 同步，需显式处理 skill 移除
  if (Array.isArray(_slotConfig)) {
    if (skill !== activeSkill.value) {
      activeSkill.value = skill;
      if (!skill) activeSkillName.value = null;
    }
    emit("update:modelValue", value);
    emit("change", value);
    return;
  }
  if (skill !== undefined) {
    activeSkill.value = skill;
    if (!skill) activeSkillName.value = null;
  }
  const parsed = value ? parseSenderCommand(value) : null;
  if (parsed && !activeSkill.value) {
    if (parsed.command === "goal") {
      activeSkill.value = { value: "goal", title: "🎯 Goal", closable: { disabled: false } };
      const remaining = parsed.arg;
      emit("update:modelValue", remaining);
      emit("change", remaining);
      return;
    }
    if (parsed.command === "review") {
      activeSkill.value = { value: "review", title: "🔍 Review", closable: { disabled: false } };
      const remaining = parsed.arg;
      emit("update:modelValue", remaining);
      emit("change", remaining);
      return;
    }
  }
  emit("update:modelValue", value);
  emit("change", value);
};

// ============ 附件（图片粘贴 / 拖拽 / 选择） ============
// stagedAttachments 是受控 prop（v-model:attachments）：上传、blob URL 生命周期
// 都在业务侧 useComposerData，组件只发 update:attachments / attachmentsUpload。

const stagedAttachments = computed(() => props.attachments);
const setAttachments = (next: StagedAttachment[]) => emit("update:attachments", next);
const dragActive = ref(false);
const attachmentsPanelOpen = ref(false);
type SenderHeaderPanel = "queue" | "attachments" | "permission";
const activeHeaderPanel = ref<SenderHeaderPanel>("attachments");
const hasAttachments = computed(() => stagedAttachments.value.length > 0);
const hasAttachmentPanel = computed(() => attachmentsPanelOpen.value || hasAttachments.value);
const hasPendingPermission = computed(() => Boolean(props.pendingPermission));
const hasQueuedMessages = computed(() => props.queuedMessages.length > 0);
const headerPanels = computed<SenderHeaderPanel[]>(() => [
  ...(hasQueuedMessages.value ? (["queue"] as const) : []),
  ...(hasAttachmentPanel.value ? (["attachments"] as const) : []),
  ...(hasPendingPermission.value ? (["permission"] as const) : []),
]);
const hasHeaderNavigation = computed(() => headerPanels.value.length > 1);
const visibleHeaderPanel = computed<SenderHeaderPanel>(() => {
  if (headerPanels.value.includes(activeHeaderPanel.value)) return activeHeaderPanel.value;
  // 权限请求需要立即处理：找不到用户停留的面板时优先弹出权限，而不是默认第一项（队列）
  if (hasPendingPermission.value) return "permission";
  return headerPanels.value[0] ?? "attachments";
});

const switchHeaderPanel = (direction: -1 | 1) => {
  if (!hasHeaderNavigation.value) return;
  const panels = headerPanels.value;
  const currentIndex = panels.indexOf(activeHeaderPanel.value);
  activeHeaderPanel.value = panels[(currentIndex + direction + panels.length) % panels.length];
};

watch(
  () => props.queuedMessages.length,
  (length, previousLength) => {
    if (length > previousLength && !hasPendingPermission.value) activeHeaderPanel.value = "queue";
  },
);

// 权限请求到达立即切到权限面板——藏在队列/附件后面不处理，
// agent 会一直等，最终权限请求超时被取消（「权限请求已取消」）。
watch(hasPendingPermission, (pending) => {
  if (pending) activeHeaderPanel.value = "permission";
});

/** 打开附件面板并把文件交给业务侧上传（useComposerData.handleAttachmentsUpload）。 */
const stageFiles = (files: File[]) => {
  attachmentsPanelOpen.value = true;
  activeHeaderPanel.value = "attachments";
  emit("attachmentsUpload", files);
};

/** Sender 的 onPasteFile：粘贴文件（含截图）时加入附件。 */
const handlePasteFile = (files: FileList) => {
  stageFiles(Array.from(files));
};

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  if (event.dataTransfer?.types.includes("Files")) dragActive.value = true;
};

const handleDragLeave = (event: DragEvent) => {
  if (event.target === event.currentTarget) dragActive.value = false;
};

const handleDrop = (event: DragEvent) => {
  dragActive.value = false;
  const files = event.dataTransfer?.files;
  if (files?.length) {
    event.preventDefault();
    stageFiles(Array.from(files));
  }
};

const removeAttachment = (index: number) => {
  setAttachments(stagedAttachments.value.filter((_, i) => i !== index));
};

const handleSubmit = (value: string, _slotConfig?: unknown[], submittedSkill?: SkillType) => {
  const prompt = value.trim();
  const ready = stagedAttachments.value.filter((entry) => entry.reference && !entry.uploading);
  if (!prompt && ready.length === 0 && !activeSkill.value && !submittedSkill) return;
  const effectiveSkill = submittedSkill ?? activeSkill.value;
  let parsed = prompt ? parseSenderCommand(prompt) : null;
  let skillCommand: { command: string; rawGoal: string } | undefined;
  let submitText = prompt;
  if (effectiveSkill) {
    const skillValue = String(effectiveSkill.value ?? "").toLowerCase();
    if (skillValue === "goal") {
      skillCommand = { command: "goal", rawGoal: prompt };
      submitText = `🎯 目标指令：${prompt}`;
    } else if (skillValue === "review") {
      skillCommand = { command: "review", rawGoal: prompt };
      submitText = `🔍 复审指令：${prompt}`;
    } else if (activeSkillName.value) {
      // skill tag：还原为当前 CLI 认的唤起文本（claude/opencode "/name"、codex "$name"、
      // pi/omp "/skill:name"），由 Agent CLI 自行解析执行
      const token = formatSkillCommand(skillSyntax.value, activeSkillName.value);
      submitText = `${token}${prompt ? ` ${prompt}` : ""}`;
    }
  } else if (parsed) {
    submitText = formatCommandForModel(parsed);
    skillCommand = { command: parsed.command, rawGoal: parsed.arg };
  }
  const commandMeta = skillCommand;
  // @ts-expect-error submit 事件在 Chat.vue 侧扩展为支持第三参 commandMeta
  emit(
    "submit",
    submitText,
    ready.map(({ reference, name }) => ({ reference, name, isImage: true })),
    commandMeta,
  );
  // 提交后清空附件：blob URL 的 revoke 由业务侧 handleAttachmentsChange diff 完成
  setAttachments([]);
  attachmentsPanelOpen.value = false;
  if (effectiveSkill) activeSkill.value = undefined;
  activeSkillName.value = null;
};

let isImeComposing = false;
let suppressPostCompositionEnter = false;
let compositionEndTimer: ReturnType<typeof setTimeout> | undefined;

const handleCompositionStart = () => {
  isImeComposing = true;
  suppressPostCompositionEnter = false;
  if (compositionEndTimer) clearTimeout(compositionEndTimer);
};

const handleCompositionEnd = () => {
  isImeComposing = false;
  suppressPostCompositionEnter = true;
  if (compositionEndTimer) clearTimeout(compositionEndTimer);
  // WebKit may emit compositionend before the Enter keydown that committed
  // the candidate. Keep the guard through the current browser task only, so a
  // deliberate subsequent Enter can still send normally.
  compositionEndTimer = setTimeout(() => {
    suppressPostCompositionEnter = false;
    compositionEndTimer = undefined;
  }, 0);
};

/** Returning false tells Sender not to interpret this Enter as submit. */
const handleSenderKeyDown = (event: KeyboardEvent): void | false => {
  if (
    isImeComposing ||
    event.isComposing ||
    event.keyCode === 229 ||
    (event.key === "Enter" && suppressPostCompositionEnter)
  ) {
    return false;
  }
  const qc = quickCommandsRef.value as unknown as {
    shouldShow: boolean;
    move: (d: -1 | 1) => boolean;
    confirm: () => boolean;
  } | null;
  if (qc?.shouldShow) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      qc.move(1);
      return false;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      qc.move(-1);
      return false;
    }
    if (event.key === "Enter") {
      if (qc.confirm()) {
        event.preventDefault();
        return false;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dismissSuggestion();
      return false;
    }
  }
};

onBeforeUnmount(() => {
  if (compositionEndTimer) clearTimeout(compositionEndTimer);
});

const toggleAttachmentsPanel = () => {
  attachmentsPanelOpen.value = !attachmentsPanelOpen.value;
  if (attachmentsPanelOpen.value) activeHeaderPanel.value = "attachments";
};

const chipClass = (active: boolean, disabled = false) => {
  if (disabled) return cx(styles.chip, styles.chipDisabled);
  return cx(styles.chip, active ? styles.chipActive : undefined);
};
</script>

<template>
  <section
    class="chat-footer"
    :class="[styles.chatFooter, { 'has-bottom-card': showBottomCard }]"
    aria-label="消息输入区"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- 定位锚点：header 浮层 / Sender / 底部卡片共用一个 wrapper，
         浮层偏移量相对 wrapper 计算，外层布局变化不影响悬浮位置。 -->
    <div class="sender-stack">
      <!-- 由 Sender 外部承载，避免附件上传状态被 Sender slot 的渲染节奏延迟。 -->
      <Transition name="sender-header">
        <div
          v-if="hasSuggestion || hasQueuedMessages || hasAttachmentPanel || pendingPermission"
          class="sender-header-card"
          :class="[
            {
              'has-permission': Boolean(pendingPermission),
              'has-suggestion': hasSuggestion,
              'has-navigation': hasHeaderNavigation,
            },
          ]"
        >
          <button
            v-if="hasHeaderNavigation"
            type="button"
            class="sender-header-nav sender-header-nav-left"
            aria-label="切换到上一个面板"
            title="上一个面板"
            @click="switchHeaderPanel(-1)"
          >
            <ChevronLeft class="sender-header-nav-icon" />
          </button>
          <div :class="['sender-header-panel']">
            <div v-if="hasSuggestion" class="quick-commands-inline">
              <QuickCommands
                ref="quickCommandsRef"
                :model-value="modelValue"
                :is-oh-my-pi="isOhMyPi"
                :skill-syntax="skillSyntax"
                :skills="props.skills"
                @select="handleSuggestionSelect"
                @close="dismissSuggestion"
              />
            </div>
            <QueuePanel
              v-else-if="visibleHeaderPanel === 'queue'"
              :queued-messages="queuedMessages"
              :queue-paused="queuePaused"
              :loading="loading"
              @change="(id, content) => emit('queuedMessageChange', id, content)"
              @remove="(id) => emit('queuedMessageRemove', id)"
              @clear="emit('queuedMessageClear')"
              @send="emit('queuedMessageSend')"
            />
            <AttachmentPanel
              v-else-if="visibleHeaderPanel === 'attachments'"
              :attachments="stagedAttachments"
              @remove="removeAttachment"
              @upload="stageFiles"
            />
            <PermissionRequestPanel
              v-else-if="pendingPermission"
              :request="pendingPermission"
              @response="emit('permissionResponse', $event)"
            />
          </div>
          <button
            v-if="hasHeaderNavigation"
            type="button"
            class="sender-header-nav sender-header-nav-right"
            aria-label="切换到下一个面板"
            title="下一个面板"
            @click="switchHeaderPanel(1)"
          >
            <ChevronRight class="sender-header-nav-icon" />
          </button>
        </div>
      </Transition>
      <Sender
        ref="senderRef"
        :value="modelValue"
        :slot-config="senderSlotConfig"
        :loading="false"
        :skill="activeSkill"
        placeholder="做什么都可以... 输入 / 唤起指令与技能"
        :on-cancel="() => emit('cancel')"
        :on-change="handleChange"
        :on-submit="handleSubmit"
        :on-key-down="handleSenderKeyDown"
        :on-paste-file="handlePasteFile"
        @compositionstart="handleCompositionStart"
        @compositionend="handleCompositionEnd"
        :suffix="false"
        :disabled="disabled || (agentMode && !agentAvailable)"
      >
        <template #footer="{ defaultNode }">
          <div :class="styles.footerCol">
            <div class="sender-footer-row">
              <!-- composer 左排：附件、推理、工作模式和文件工作区 -->
              <div class="sender-footer-primary">
                <Tooltip title="添加图片（支持粘贴 / 拖拽）">
                  <button
                    type="button"
                    :class="chipClass(false)"
                    aria-label="添加图片"
                    :aria-expanded="attachmentsPanelOpen"
                    @click="toggleAttachmentsPanel"
                  >
                    <ImagePlus
                      class="!h-[12px] !w-[12px] flex-none"
                      :class="stagedAttachments.length ? styles.textAccent : ''"
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
                  <button
                    type="button"
                    :class="chipClass(props.mode === 'plan')"
                    aria-label="工作模式"
                  >
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
                <Dropdown
                  :menu="modelMenu"
                  v-model:open="modelMenuOpen"
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
                        : undefined
                    "
                  >
                    <ModelIcon v-if="brandedModel" :model="brandedModel" :size="13" />
                    <Cpu
                      v-else
                      class="!h-[13px] !w-[13px] flex-none"
                      :class="styles.textMutedStrong"
                    />
                    <span class="sender-flat-model-label">{{
                      currentModelLabel || "选择模型"
                    }}</span>
                    <ChevronDown
                      v-if="modelSelectionAvailable"
                      class="!h-3 !w-3 flex-none"
                      :class="styles.textMutedStrong"
                    />
                  </button>
                </Dropdown>
                <component :is="defaultNode" />
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
      </Sender>
      <!-- sender 底部卡片：项目目录 / Git 分支，去 pill 化后由卡片包裹，底部圆角与上方输入卡片连成一张 -->
      <div v-if="showBottomCard" class="sender-bottom-card">
        <div class="sender-bottom-row">
          <div class="sender-flat-project" :class="{ 'is-selected': Boolean(projectPath) }">
            <Dropdown
              :menu="projectPathMenu"
              :trigger="['click']"
              placement="topLeft"
              :disabled="loading || projectPathPicking"
            >
              <button
                type="button"
                class="sender-flat-btn"
                :class="{ 'is-disabled': loading || projectPathPicking }"
                :aria-pressed="Boolean(projectPath)"
                aria-label="项目工作目录"
                :title="projectPathPicking ? '等待系统目录选择器' : projectPathName || '无文件目录'"
                :disabled="loading || projectPathPicking"
              >
                <FolderOpen
                  class="!h-[13px] !w-[13px] flex-none"
                  :class="projectPath ? styles.textAccent : styles.textMutedStrong"
                />
                <span class="sender-flat-label">
                  {{ projectPathName || "无文件目录" }}
                </span>
                <ChevronDown class="!h-3 !w-3 flex-none" :class="styles.textMutedStrong" />
              </button>
            </Dropdown>
            <Tooltip v-if="projectPath" title="清除项目目录">
              <button
                type="button"
                class="sender-flat-clear"
                aria-label="清除项目目录"
                :disabled="loading || projectPathPicking"
                @click="clearProjectPath"
              >
                <X class="!h-[11px] !w-[11px]" />
              </button>
            </Tooltip>
          </div>

          <span v-if="gitWorkspace?.isRepository" class="sender-flat-sep" />
          <Dropdown
            v-if="gitWorkspace?.isRepository"
            :menu="gitBranchMenu"
            :trigger="['click']"
            placement="topLeft"
            :disabled="loading || props.gitBusy"
            @open-change="handleGitMenuOpen"
          >
            <button
              type="button"
              class="sender-flat-btn"
              :class="{ 'is-disabled': loading || props.gitBusy }"
              aria-label="Git 分支"
              :title="gitBranchLabel"
              :disabled="loading || props.gitBusy"
            >
              <GitBranch class="!h-[13px] !w-[13px] flex-none" :class="styles.textAccent" />
              <span class="sender-flat-label">{{ gitBranchLabel }}</span>
              <ChevronDown class="!h-3 !w-3 flex-none" :class="styles.textMutedStrong" />
            </button>
          </Dropdown>

          <div class="min-w-0 flex-1" />
        </div>
      </div>
    </div>
    <div v-if="dragActive" class="drop-overlay">松开以添加图片</div>
  </section>
</template>

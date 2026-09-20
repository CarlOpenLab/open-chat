<script setup lang="ts">
import type { SkillType } from "@antdv-next/x";
import { BrainCircuit, FolderOpen } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch, type Component } from "vue";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import type { StagedAttachment } from "../../composables/useComposerData";
import type { PermissionRequest } from "../../services/OpenChatProvider";
import type { GitWorkspaceInfo, SkillsIndex, UploadedAttachment } from "../../services/ai";
import type { QueuedChatMessage } from "../../services/chatStorage";
import {
  filterSuggestionGroups,
  formatCommandForModel,
  formatSkillCommand,
  parseSenderCommand,
  skillCommandSyntax,
} from "../../utils/senderCommands";
import type { QuickCommandMeta, SenderSuggestion } from "../../utils/senderCommands";
import SenderBottomBar from "../sender/SenderBottomBar.vue";
import SenderLayout from "../sender/SenderLayout.vue";
import SenderToolbar from "../sender/SenderToolbar.vue";
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

/** 输入区底部卡片：有项目目录 / Git 分支上下文时展示（与上方输入卡片连成一张卡片）。 */
const showBottomCard = computed(() => props.projectPathEnabled);

// ============ 推理强度 ============

type ReasoningLevel = "lowest" | "low" | "medium" | "high";

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

/** 推理难度档位选择（chip / 菜单在 SenderToolbar）：只有「最低」代表关闭深度思考。 */
const handleReasoningLevelChange = (level: ReasoningLevel) => {
  reasoningLevel.value = level;
  emit("thinkingChange", level !== "lowest");
};

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
const senderLayoutRef = ref<InstanceType<typeof SenderLayout> | null>(null);

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
    (senderLayoutRef.value as unknown as { focus?: () => void })?.focus?.();
  }, 0);
};

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

/** 打开附件面板并把文件交给业务侧上传（拖拽 / 粘贴 / 选择三入口共用）。 */
const stageFiles = (files: File[]) => {
  attachmentsPanelOpen.value = true;
  activeHeaderPanel.value = "attachments";
  emit("attachmentsUpload", files);
};

/** Sender 的 onPasteFile：粘贴文件（含截图）时加入附件。 */
const handlePasteFile = (files: FileList) => {
  stageFiles(Array.from(files));
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
</script>

<template>
  <!-- 壳层布局（浮层 / 底部卡片 / 拖拽遮罩 / Sender 覆写）在 SenderLayout，
       业务面板与工具行经 slots 组合进去；副作用全部经事件上抛。 -->
  <SenderLayout
    ref="senderLayoutRef"
    :value="modelValue"
    :slot-config="senderSlotConfig"
    :loading="false"
    :skill="activeSkill"
    placeholder="做什么都可以... 输入 / 唤起指令与技能"
    :disabled="disabled || (agentMode && !agentAvailable)"
    :has-bottom-card="showBottomCard"
    :header-variant="hasSuggestion ? 'float' : 'card'"
    :header-navigable="hasHeaderNavigation"
    :on-change="handleChange"
    :on-submit="handleSubmit"
    :on-key-down="handleSenderKeyDown"
    :on-cancel="() => emit('cancel')"
    :on-paste-file="handlePasteFile"
    @compositionstart="handleCompositionStart"
    @compositionend="handleCompositionEnd"
    @header-nav="switchHeaderPanel"
    @drop-files="stageFiles"
  >
    <!-- header 浮层：斜杠建议（float）或 队列 / 附件 / 权限 面板（card） -->
    <template
      v-if="hasSuggestion || hasQueuedMessages || hasAttachmentPanel || pendingPermission"
      #header
    >
      <QuickCommands
        v-if="hasSuggestion"
        ref="quickCommandsRef"
        :model-value="modelValue"
        :is-oh-my-pi="isOhMyPi"
        :skill-syntax="skillSyntax"
        :skills="props.skills"
        @select="handleSuggestionSelect"
        @close="dismissSuggestion"
      />
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
    </template>

    <!-- Sender footer：工具行（chips / 模型选择 / 发送 / 停止）在 SenderToolbar，
         defaultNode 是 Sender 提供的发送按钮 -->
    <template #footer="{ defaultNode }">
      <SenderToolbar
        :default-node="defaultNode"
        :has-attachments="stagedAttachments.length > 0"
        :attachments-panel-open="attachmentsPanelOpen"
        :thinking-enabled="thinkingEnabled"
        :reasoning-level="reasoningLevel"
        :thinking-icon="props.thinkingIcon"
        :permission="permission"
        :permission-locked="permissionLocked"
        :mode="mode"
        :file-mode-enabled="fileModeEnabled"
        :file-icon="props.fileIcon"
        :run-state="runState"
        :loading="loading"
        :model="currentModel"
        :model-label="currentModelLabel"
        :model-catalog="modelCatalog"
        :agent-mode="agentMode"
        :agent-configuring="agentConfiguring"
        @toggle-attachments="toggleAttachmentsPanel"
        @reasoning-level-change="handleReasoningLevelChange"
        @permission-change="(value) => emit('permissionChange', value)"
        @mode-change="(value) => emit('modeChange', value)"
        @file-mode-change="(value) => emit('fileModeChange', value)"
        @model-change="(key) => emit('modelChange', key)"
        @cancel="emit('cancel')"
      />
    </template>

    <!-- 底部卡片：项目目录 / Git 分支（与上方输入卡片连成一张卡片）在 SenderBottomBar -->
    <template v-if="showBottomCard" #bottom>
      <SenderBottomBar
        :project-path="projectPath"
        :project-path-options="projectPathOptions"
        :project-path-picking="projectPathPicking"
        :loading="loading"
        :git-workspace="gitWorkspace"
        :git-busy="gitBusy"
        @project-path-change="(value) => emit('projectPathChange', value)"
        @project-path-remove="(value) => emit('projectPathRemove', value)"
        @pick-project-path="emit('pickProjectPath')"
        @git-workspace-refresh="emit('gitWorkspaceRefresh')"
        @git-branch-switch="(branch) => emit('gitBranchSwitch', branch)"
      />
    </template>
  </SenderLayout>
</template>

<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import {
  AlertTriangle,
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
  Paperclip,
  Pencil,
  SendHorizontal,
  ShieldCheck,
  ShieldQuestion,
  Square,
  Trash2,
  X,
} from "@lucide/vue";
import { Dropdown, Tooltip, message, type MenuProps } from "antdv-next";
import { computed, h, onBeforeUnmount, ref, watch, type Component } from "vue";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import type { PermissionRequest } from "../../services/OpenChatProvider";
import { aiService, type GitWorkspaceInfo, type UploadedAttachment } from "../../services/ai";
import type { QueuedChatMessage } from "../../services/chatStorage";
import { normalizeDirectoryPath, uniqueDirectoryPaths } from "../../utils/projectPath";
import ModelIcon from "../Icons/ModelIcon.vue";

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
  /** 深度思考 chip 的图标，可配置（默认 BrainCircuit） */
  thinkingIcon?: Component;
  /** 文件工作区 chip 的图标，可配置（默认 FolderOpen） */
  fileIcon?: Component;
}

interface Emits {
  (e: "update:modelValue", value: string): void;
  (e: "change", value: string): void;
  (e: "cancel"): void;
  (e: "submit", value: string, attachments: UploadedAttachment[]): void;
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
});
const emit = defineEmits<Emits>();
const projectPathPicking = ref(false);

const pathName = (path: string): string => {
  const normalized = normalizeDirectoryPath(path);
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
};

const projectPathName = computed(() => pathName(String(props.projectPath || "")));

const projectPathMenu = computed<MenuProps>(() => {
  const paths = uniqueDirectoryPaths(props.projectPathOptions);
  const currentPath = normalizeDirectoryPath(props.projectPath);
  const currentIndex = paths.indexOf(currentPath);
  const items: NonNullable<MenuProps["items"]> = [
    { key: "__none__", label: "无文件目录", icon: h(Check) },
    ...paths.map((path, index) => ({
      key: `__path_${index}__`,
      label: h("div", { class: "project-path-menu-row", title: path }, [
        h("span", { class: "project-path-menu-copy" }, [
          h("span", { class: "project-path-menu-name" }, pathName(path) || "未命名目录"),
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
      ]),
    })),
    { type: "divider" },
    { key: "__pick__", label: "选择其他目录", icon: h(FolderOpen) },
  ];

  return {
    rootClass: "project-path-menu",
    items,
    selectable: true,
    selectedKeys: [currentIndex >= 0 ? `__path_${currentIndex}__` : "__none__"],
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

const pickProjectPath = async () => {
  if (projectPathPicking.value) return;
  projectPathPicking.value = true;
  try {
    const result = await aiService.pickProjectPath();
    if (result.path) {
      emit("projectPathChange", result.path);
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : "系统目录选择器不可用");
  } finally {
    projectPathPicking.value = false;
  }
};

const gitWorkspace = ref<GitWorkspaceInfo | null>(null);
const gitWorkspacePath = ref("");
const gitBranchSwitching = ref(false);
let gitWorkspaceSequence = 0;

const loadGitWorkspace = async (path = props.projectPath) => {
  const projectPath = path.trim();
  const sequence = ++gitWorkspaceSequence;
  if (!projectPath) {
    gitWorkspace.value = null;
    gitWorkspacePath.value = "";
    return;
  }
  if (gitWorkspacePath.value !== projectPath) gitWorkspace.value = null;
  try {
    const workspace = await aiService.getGitWorkspace(projectPath);
    if (sequence === gitWorkspaceSequence && projectPath === props.projectPath.trim()) {
      gitWorkspace.value = workspace;
      gitWorkspacePath.value = projectPath;
    }
  } catch (error) {
    if (sequence === gitWorkspaceSequence) {
      message.error(error instanceof Error ? error.message : "Git 状态读取失败");
    }
  }
};

watch(
  () => props.projectPath,
  (path) => void loadGitWorkspace(path),
  { immediate: true },
);

watch(
  () => props.loading,
  (loading, wasLoading) => {
    if (wasLoading && !loading && props.projectPath.trim()) void loadGitWorkspace();
  },
);

const handleGitMenuOpen = (open: boolean) => {
  if (open && !props.loading && props.projectPath.trim()) void loadGitWorkspace();
};

const gitBranchLabel = computed(() => {
  if (gitBranchSwitching.value) return "切换中...";
  if (gitWorkspace.value?.currentBranch) {
    return `${gitWorkspace.value.currentBranch}${gitWorkspace.value.dirty ? " *" : ""}`;
  }
  return gitWorkspace.value?.detached ? "detached HEAD" : "Git 分支";
});

const switchBranch = async (branch: string) => {
  const projectPath = props.projectPath.trim();
  if (!projectPath || gitBranchSwitching.value || branch === gitWorkspace.value?.currentBranch)
    return;
  gitBranchSwitching.value = true;
  try {
    gitWorkspace.value = await aiService.switchGitBranch(projectPath, branch);
    message.success(`已切换到 ${branch}`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : "Git 分支切换失败");
  } finally {
    gitBranchSwitching.value = false;
  }
};

const gitBranchMenu = computed<MenuProps>(() => ({
  rootClass: "git-branch-menu",
  items: (gitWorkspace.value?.branches ?? []).map((branch) => ({
    key: branch,
    label: branch,
    icon: branch === gitWorkspace.value?.currentBranch ? h(Check) : undefined,
  })),
  selectable: true,
  selectedKeys: gitWorkspace.value?.currentBranch ? [gitWorkspace.value.currentBranch] : [],
  onClick: ({ key }) => void switchBranch(String(key)),
}));

/** 让下拉菜单渲染在 .chat-app 内部，brand CSS 变量才能生效（antd 弹层默认挂到 body）。 */
const popupIntoChat = (trigger: HTMLElement) => trigger.closest(".chat-app") ?? document.body;

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
    rootClass: "chat-model-menu",
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
  rootClass: "reasoning-level-menu",
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
  rootClass: "sender-option-menu",
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
  rootClass: "sender-option-menu",
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

const pendingPermissionLabel = computed(() => {
  const name = props.pendingPermission?.permission ?? "";
  const labels: Record<string, string> = {
    bash: "执行终端命令",
    edit: "修改文件",
    write: "修改文件",
    apply_patch: "修改文件",
    read: "读取文件",
    task: "创建子任务",
    webfetch: "访问网页",
  };
  return labels[name] || name || "执行操作";
});

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

const pendingPermissionDetails = computed(() => {
  const request = props.pendingPermission;
  if (!request) return [];
  const details = [...(request.patterns ?? [])];
  for (const [key, value] of Object.entries(request.metadata ?? {})) {
    if (key === "title" || key === "description" || value === undefined || value === null) {
      continue;
    }
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text) details.push(text);
  }
  return details;
});

const pendingPermissionActions = computed(() => {
  const options = props.pendingPermission?.options;
  if (!options?.length) {
    return [
      { response: "reject" as const, label: "拒绝", primary: false },
      { response: "once" as const, label: "允许一次", primary: true },
      { response: "always" as const, label: "始终允许", primary: true },
    ];
  }
  const actions: Array<{
    response: "once" | "always" | "reject";
    label: string;
    primary: boolean;
  }> = [];
  for (const option of options) {
    const response = option.kind.startsWith("reject")
      ? "reject"
      : option.kind === "allow_always"
        ? "always"
        : "once";
    if (actions.some((item) => item.response === response)) continue;
    actions.push({
      response,
      label: option.kind.startsWith("reject")
        ? "拒绝"
        : option.kind === "allow_always"
          ? "始终允许"
          : "允许一次",
      primary: response !== "reject",
    });
  }
  return actions;
});

const handleChange = (value: string) => {
  emit("update:modelValue", value);
  emit("change", value);
};

// ============ 附件（图片粘贴 / 拖拽 / 选择） ============

/** 输入框中的待发送附件：上传完成前本地预览，上传后携带持久引用。 */
interface StagedAttachment extends UploadedAttachment {
  /** 去重键：name + size + lastModified。 */
  sourceKey: string;
  /** 本地预览 URL（blob:），发送前有效。 */
  previewUrl: string;
  uploading: boolean;
  error?: string;
}

const stagedAttachments = ref<StagedAttachment[]>([]);
const dragActive = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
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
    if (length > previousLength) activeHeaderPanel.value = "queue";
  },
);

/** 把 File 列表上传到网关并加入预览行；非图片忽略。 */
const stageFiles = async (files: File[]) => {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const sourceKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (stagedAttachments.value.some((entry) => entry.sourceKey === sourceKey)) continue;
    const previewUrl = URL.createObjectURL(file);
    const entry: StagedAttachment = {
      sourceKey,
      reference: "",
      name: file.name,
      isImage: true,
      previewUrl,
      uploading: true,
    };
    stagedAttachments.value.push(entry);
    try {
      const uploaded = await aiService.uploadAttachment(file);
      entry.reference = uploaded.reference;
      entry.name = uploaded.name;
      // The input only accepts image MIME types. Keep the client-side image
      // flag even when a filename has no extension and the gateway cannot
      // infer it from the name alone.
      entry.isImage = true;
      entry.uploading = false;
      stagedAttachments.value = [...stagedAttachments.value];
    } catch (error) {
      entry.uploading = false;
      entry.error = error instanceof Error ? error.message : "上传失败";
      stagedAttachments.value = [...stagedAttachments.value];
    }
  }
};

/** Sender 的 onPasteFile：粘贴文件（含截图）时加入附件。 */
const handlePasteFile = (files: FileList) => {
  attachmentsPanelOpen.value = true;
  activeHeaderPanel.value = "attachments";
  void stageFiles(Array.from(files));
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
    attachmentsPanelOpen.value = true;
    activeHeaderPanel.value = "attachments";
    void stageFiles(Array.from(files));
  }
};

const pickFiles = () => fileInputRef.value?.click();

const handleFileInputChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) void stageFiles(Array.from(input.files));
  input.value = "";
};

const removeAttachment = (index: number) => {
  const entry = stagedAttachments.value[index];
  if (entry?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(entry.previewUrl);
  stagedAttachments.value.splice(index, 1);
};

const handleSubmit = (value: string) => {
  const prompt = value.trim();
  const ready = stagedAttachments.value.filter((entry) => entry.reference && !entry.uploading);
  if (!prompt && ready.length === 0) return;
  emit(
    "submit",
    prompt,
    ready.map(({ reference, name }) => ({ reference, name, isImage: true })),
  );
  for (const entry of stagedAttachments.value) {
    if (entry.previewUrl.startsWith("blob:")) URL.revokeObjectURL(entry.previewUrl);
  }
  stagedAttachments.value = [];
  attachmentsPanelOpen.value = false;
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
};

onBeforeUnmount(() => {
  if (compositionEndTimer) clearTimeout(compositionEndTimer);
});

const editingQueueId = ref("");
const editingQueueValue = ref("");

const startQueueEdit = (item: QueuedChatMessage) => {
  editingQueueId.value = item.id;
  editingQueueValue.value = item.content;
};

const cancelQueueEdit = () => {
  editingQueueId.value = "";
  editingQueueValue.value = "";
};

const saveQueueEdit = (item: QueuedChatMessage) => {
  const content = editingQueueValue.value.trim();
  if (!content && !item.attachments?.length) return;
  emit("queuedMessageChange", item.id, content);
  cancelQueueEdit();
};

const handleQueueEditKeydown = (event: KeyboardEvent, item: QueuedChatMessage) => {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelQueueEdit();
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    saveQueueEdit(item);
  }
};

const toggleAttachmentsPanel = () => {
  attachmentsPanelOpen.value = !attachmentsPanelOpen.value;
  if (attachmentsPanelOpen.value) activeHeaderPanel.value = "attachments";
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
    :class="{ 'has-bottom-card': showBottomCard }"
    aria-label="消息输入区"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- 由 Sender 外部承载，避免附件上传状态被 Sender slot 的渲染节奏延迟。 -->
    <Transition name="sender-header">
      <div
        v-if="hasQueuedMessages || hasAttachmentPanel || pendingPermission"
        class="sender-header-card"
        :class="{
          'has-permission': Boolean(pendingPermission),
          'has-navigation': hasHeaderNavigation,
        }"
      >
        <button
          v-if="hasHeaderNavigation"
          type="button"
          class="sender-header-nav sender-header-nav-left"
          aria-label="切换到上一个面板"
          title="上一个面板"
          @click="switchHeaderPanel(-1)"
        >
          <ChevronLeft class="!h-4 !w-4" />
        </button>
        <div class="sender-header-panel">
          <div v-if="visibleHeaderPanel === 'queue'" class="queued-message-panel">
            <div class="queued-message-heading">
              <span>待发送 · {{ queuedMessages.length }}</span>
              <div class="queued-message-heading-actions">
                <span v-if="queuePaused" class="queued-message-state">已暂停</span>
                <Tooltip title="清空队列">
                  <button
                    type="button"
                    class="queued-message-clear"
                    aria-label="清空队列"
                    @click="emit('queuedMessageClear')"
                  >
                    <Trash2 class="!h-3.5 !w-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div class="queued-message-list">
              <div
                v-for="(item, index) in queuedMessages"
                :key="item.id"
                class="queued-message-item"
              >
                <span class="queued-message-order">{{ index + 1 }}</span>
                <textarea
                  v-if="editingQueueId === item.id"
                  v-model="editingQueueValue"
                  class="queued-message-editor"
                  rows="2"
                  @keydown="handleQueueEditKeydown($event, item)"
                ></textarea>
                <div v-else class="queued-message-copy">
                  <span class="queued-message-content">{{ item.content || "仅附件" }}</span>
                  <span v-if="item.attachments?.length" class="queued-message-attachments">
                    <Paperclip class="!h-3 !w-3" />{{ item.attachments.length }}
                  </span>
                </div>
                <div class="queued-message-actions">
                  <template v-if="editingQueueId === item.id">
                    <Tooltip title="保存">
                      <button
                        type="button"
                        class="queued-message-action"
                        aria-label="保存队列消息"
                        :disabled="!editingQueueValue.trim() && !item.attachments?.length"
                        @click="saveQueueEdit(item)"
                      >
                        <Check class="!h-3.5 !w-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip title="取消">
                      <button
                        type="button"
                        class="queued-message-action"
                        aria-label="取消编辑"
                        @click="cancelQueueEdit"
                      >
                        <X class="!h-3.5 !w-3.5" />
                      </button>
                    </Tooltip>
                  </template>
                  <template v-else>
                    <Tooltip v-if="index === 0 && !loading" title="发送下一条">
                      <button
                        type="button"
                        class="queued-message-action is-primary"
                        aria-label="发送下一条队列消息"
                        @click="emit('queuedMessageSend')"
                      >
                        <SendHorizontal class="!h-3.5 !w-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip title="编辑">
                      <button
                        type="button"
                        class="queued-message-action"
                        aria-label="编辑队列消息"
                        @click="startQueueEdit(item)"
                      >
                        <Pencil class="!h-3.5 !w-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip title="删除">
                      <button
                        type="button"
                        class="queued-message-action is-danger"
                        aria-label="删除队列消息"
                        @click="emit('queuedMessageRemove', item.id)"
                      >
                        <Trash2 class="!h-3.5 !w-3.5" />
                      </button>
                    </Tooltip>
                  </template>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="visibleHeaderPanel === 'attachments'" class="attachment-preview-row">
            <div
              v-for="(attachment, index) in stagedAttachments"
              :key="attachment.sourceKey"
              class="attachment-tile"
              :class="{
                'is-uploading': attachment.uploading,
                'has-error': Boolean(attachment.error),
              }"
            >
              <img
                v-if="attachment.isImage"
                :src="attachment.previewUrl"
                class="attachment-image"
                alt=""
              />
              <button
                type="button"
                class="attachment-remove"
                aria-label="移除附件"
                title="删除图片"
                @click.stop.prevent="removeAttachment(index)"
              >
                <X class="!h-[10px] !w-[10px]" />
              </button>
              <div v-if="attachment.uploading" class="attachment-overlay">上传中…</div>
              <div v-else-if="attachment.error" class="attachment-overlay">上传失败</div>
            </div>
            <button type="button" class="attachment-add" aria-label="添加图片" @click="pickFiles">
              <ImagePlus class="!h-[14px] !w-[14px]" />
            </button>
          </div>
          <div v-else-if="pendingPermission" class="permission-request-inline">
            <div class="permission-request-title">
              <AlertTriangle
                class="!h-[14px] !w-[14px] flex-none text-[color:var(--brand-warning,#b7791f)]"
              />
              <span>需要授权：{{ pendingPermissionLabel }}</span>
            </div>
            <div v-if="pendingPermissionDetails.length" class="permission-request-details">
              {{ pendingPermissionDetails.join("\n") }}
            </div>
            <div class="permission-request-actions">
              <button
                v-for="action in pendingPermissionActions"
                :key="action.response"
                type="button"
                class="permission-request-action"
                :class="action.primary ? 'is-primary' : ''"
                @click="emit('permissionResponse', action.response)"
              >
                <ShieldCheck v-if="action.response === 'always'" class="!h-[13px] !w-[13px]" />
                <ShieldQuestion
                  v-else-if="action.response === 'once'"
                  class="!h-[13px] !w-[13px]"
                />
                {{ action.label }}
              </button>
            </div>
          </div>
        </div>
        <button
          v-if="hasHeaderNavigation"
          type="button"
          class="sender-header-nav sender-header-nav-right"
          aria-label="切换到下一个面板"
          title="下一个面板"
          @click="switchHeaderPanel(1)"
        >
          <ChevronRight class="!h-4 !w-4" />
        </button>
      </div>
    </Transition>
    <!-- 常驻挂载，初次点击“添加图片”时也能正常打开文件选择器。 -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      hidden
      @change="handleFileInputChange"
    />
    <Sender
      :value="modelValue"
      :loading="false"
      placeholder="做什么都可以..."
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
        <div class="flex w-full flex-col gap-2">
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
                    :class="stagedAttachments.length ? 'text-brand-accent' : ''"
                  />
                </button>
              </Tooltip>
              <Dropdown
                :menu="reasoningMenu"
                :trigger="['click']"
                placement="topLeft"
                :get-popup-container="popupIntoChat"
              >
                <button
                  type="button"
                  :class="chipClass(thinkingEnabled)"
                  aria-label="推理难度"
                  title="推理难度"
                >
                  <component
                    :is="props.thinkingIcon"
                    class="!h-[12px] !w-[12px] flex-none"
                    :class="thinkingEnabled ? 'text-brand-accent' : 'text-brand-muted-strong'"
                  />
                  <span>{{ REASONING_LABEL[reasoningLevel] }}</span>
                  <ChevronDown class="!h-3 !w-3 flex-none text-brand-muted-strong" />
                </button>
              </Dropdown>
              <Dropdown
                :menu="permissionMenu"
                :trigger="['click']"
                placement="topLeft"
                :disabled="permissionLocked"
                :get-popup-container="popupIntoChat"
              >
                <button
                  type="button"
                  :class="chipClass(true, permissionLocked)"
                  aria-label="权限策略"
                  :title="permissionLocked ? '该供应商固定为完全访问' : '权限策略'"
                >
                  <ShieldCheck class="!h-[12px] !w-[12px] flex-none text-brand-accent" />
                  <span>{{
                    { supervised: "有监督", auto: "自动", full: "完全访问" }[props.permission]
                  }}</span>
                  <ChevronDown class="!h-3 !w-3 flex-none text-brand-muted-strong" />
                </button>
              </Dropdown>
              <Dropdown
                :menu="modeMenu"
                :trigger="['click']"
                placement="topLeft"
                :get-popup-container="popupIntoChat"
              >
                <button
                  type="button"
                  :class="chipClass(props.mode === 'plan')"
                  aria-label="工作模式"
                >
                  <ListTodo v-if="props.mode === 'plan'" class="!h-[12px] !w-[12px] flex-none" />
                  <Hammer v-else class="!h-[12px] !w-[12px] flex-none" />
                  <span>{{ props.mode === "plan" ? "Plan 模式" : "构建模式" }}</span>
                  <ChevronDown class="!h-3 !w-3 flex-none text-brand-muted-strong" />
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
                    :class="fileModeEnabled ? 'text-brand-accent' : ''"
                  />
                  <span>文件</span>
                </button>
              </Tooltip>
              <span
                v-if="runStateLabel"
                class="ml-[6px] flex-none text-[11px] leading-[14px] text-brand-muted-strong"
                >{{ runStateLabel }}</span
              >
            </div>

            <!-- composer 右排：模型选择（扁平按钮）+ 发送 + 独立停止会话 -->
            <div class="sender-footer-secondary">
              <Dropdown
                :menu="modelMenu"
                v-model:open="modelMenuOpen"
                :trigger="['click']"
                :disabled="!modelSelectionAvailable || agentConfiguring"
                placement="topRight"
                :get-popup-container="popupIntoChat"
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
                  <Cpu v-else class="!h-[13px] !w-[13px] flex-none text-brand-muted-strong" />
                  <span class="sender-flat-model-label">{{ currentModelLabel || "选择模型" }}</span>
                  <ChevronDown
                    v-if="modelSelectionAvailable"
                    class="!h-3 !w-3 flex-none text-brand-muted-strong"
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
            :get-popup-container="popupIntoChat"
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
                :class="projectPath ? 'text-brand-accent' : 'text-brand-muted-strong'"
              />
              <span class="sender-flat-label">
                {{ projectPathName || "无文件目录" }}
              </span>
              <ChevronDown class="!h-3 !w-3 flex-none text-brand-muted-strong" />
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
          :disabled="loading || gitBranchSwitching"
          :get-popup-container="popupIntoChat"
          @open-change="handleGitMenuOpen"
        >
          <button
            type="button"
            class="sender-flat-btn"
            :class="{ 'is-disabled': loading || gitBranchSwitching }"
            aria-label="Git 分支"
            :title="gitBranchLabel"
            :disabled="loading || gitBranchSwitching"
          >
            <GitBranch class="!h-[13px] !w-[13px] flex-none text-brand-accent" />
            <span class="sender-flat-label">{{ gitBranchLabel }}</span>
            <ChevronDown class="!h-3 !w-3 flex-none text-brand-muted-strong" />
          </button>
        </Dropdown>

        <div class="min-w-0 flex-1" />
      </div>
    </div>
    <div v-if="dragActive" class="drop-overlay">松开以添加图片</div>
  </section>
</template>

<style scoped>
/* 保留原因：以下均为 :deep() 覆盖 antd / antd-x 内部类，按迁移规范保留在 scoped CSS 中 */
.sender-header-card {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 760px;
  margin: 0 auto -28px;
  border: 1px solid var(--brand-border);
  border-radius: 16px;
  background: var(--brand-composer);
  padding: 8px 8px 36px;
  box-shadow: var(--brand-shadow-float);
}
.sender-header-enter-active,
.sender-header-leave-active {
  max-height: 420px;
  overflow: hidden;
  transition:
    max-height 180ms ease,
    margin-bottom 180ms ease,
    opacity 180ms ease,
    transform 180ms ease,
    padding 180ms ease;
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
  transform: translateY(10px) scale(0.985);
}
.sender-header-card.has-permission {
  border-color: color-mix(in srgb, var(--brand-warning, #b7791f) 55%, var(--brand-border));
}
.sender-header-panel {
  min-width: 0;
}
.sender-header-card.has-navigation {
  display: flex;
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
  color: var(--brand-muted-strong);
  cursor: pointer;
}
.sender-header-nav:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.sender-header-card:not(.has-navigation) .sender-header-panel {
  width: 100%;
}
.sender-header-card.has-navigation .sender-header-panel {
  flex: 1;
  min-width: 0;
}
.sender-header-card .attachment-preview-row {
  padding: 0;
}
.sender-header-card .permission-request-inline {
  margin-top: 8px;
}
.queued-message-panel {
  padding: 1px 2px 0;
}
.queued-message-heading {
  display: flex;
  min-height: 24px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 6px 4px;
  color: var(--brand-muted-strong);
  font-size: 11.5px;
  font-weight: 600;
}
.queued-message-heading-actions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.queued-message-state {
  color: var(--brand-warning, #b7791f);
  font-weight: 500;
}
.queued-message-clear {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: transparent;
  color: var(--brand-muted-strong);
  cursor: pointer;
}
.queued-message-clear:hover {
  background: var(--brand-danger-subtle);
  color: var(--brand-danger);
}
.queued-message-list {
  display: flex;
  max-height: 190px;
  flex-direction: column;
  gap: 3px;
  overflow-y: auto;
}
.queued-message-item {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  min-height: 36px;
  align-items: center;
  gap: 7px;
  border-radius: 6px;
  padding: 4px 5px;
  background: var(--brand-surface-subtle);
}
.queued-message-order {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 50%;
  background: var(--brand-inset);
  color: var(--brand-muted-strong);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.queued-message-copy {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}
.queued-message-content {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  color: var(--brand-foreground);
  font-size: 12px;
  line-height: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.queued-message-attachments {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
  color: var(--brand-muted-strong);
  font-size: 10.5px;
}
.queued-message-editor {
  width: 100%;
  min-height: 40px;
  max-height: 92px;
  resize: vertical;
  border: 1px solid var(--brand-border-strong);
  border-radius: 5px;
  padding: 5px 7px;
  outline: none;
  background: var(--brand-composer);
  color: var(--brand-foreground);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
}
.queued-message-editor:focus {
  border-color: var(--brand-accent);
}
.queued-message-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.queued-message-action {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: transparent;
  color: var(--brand-muted-strong);
  cursor: pointer;
}
.queued-message-action:hover:not(:disabled) {
  background: var(--brand-inset);
  color: var(--brand-foreground);
}
.queued-message-action.is-primary {
  color: var(--brand-accent);
}
.queued-message-action.is-danger:hover:not(:disabled) {
  color: var(--brand-danger);
}
.queued-message-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.chat-footer :deep(.antd-sender) {
  position: relative;
  z-index: 3;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}
.chat-footer :deep(.antd-sender-main) {
  position: relative;
  z-index: 3;
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

/* 有底部卡片时，输入卡片去掉下边框和下圆角，两段视觉连成一张卡片 */
.chat-footer.has-bottom-card :deep(.antd-sender-main) {
  border-radius: 13px;
}

/* sender 底部卡片：与上方输入卡片同背景（header slot 背景），底部圆角 */
.sender-bottom-card {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 760px;
  min-height: 42px;
  margin: 0 auto;
  border: 1px solid var(--brand-border);
  border-top: 0;
  border-radius: 0 0 13px 13px;
  background: var(--brand-composer);
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
  color: var(--brand-muted-strong);
  font-size: 12.5px;
  line-height: 16px;
  cursor: pointer;
  transition:
    background 150ms ease,
    color 150ms ease;
}
.sender-flat-btn:hover:not(:disabled) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.sender-flat-btn:focus-visible {
  outline: 2px solid var(--brand-ring);
  outline-offset: 1px;
}
.sender-flat-btn.is-disabled,
.sender-flat-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
/* 模型作为主标题，比其余项更醒目 */
.sender-flat-btn-model {
  color: var(--brand-foreground);
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
  background: var(--brand-border);
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
  color: var(--brand-muted-strong);
  cursor: pointer;
}
.sender-flat-clear:hover:not(:disabled) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.sender-flat-clear:disabled {
  cursor: not-allowed;
  opacity: 0.5;
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
  border: 1px solid var(--brand-danger, #c2413b);
  border-radius: 7px;
  padding: 0;
  background: color-mix(in srgb, var(--brand-danger, #c2413b) 10%, transparent);
  color: var(--brand-danger, #c2413b);
  cursor: pointer;
  transition:
    background 150ms ease,
    color 150ms ease;
}
.sender-stop-button:hover {
  background: var(--brand-danger, #c2413b);
  color: var(--brand-workspace, #fff);
}

@media (max-width: 560px) {
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

/* 附件预览行：输入框上方，仿 Waku composer 缩略图 chip */
.attachment-preview-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 0;
}
.attachment-tile {
  position: relative;
  width: 64px;
  height: 64px;
  flex: none;
  overflow: hidden;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
  background: var(--brand-inset);
}
.attachment-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.attachment-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  padding: 0;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  opacity: 1;
  transition: opacity 140ms ease;
}
.attachment-tile:hover .attachment-remove {
  opacity: 0.92;
}
.attachment-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  color: var(--brand-foreground);
  background: color-mix(in srgb, var(--brand-workspace) 78%, transparent);
}
.attachment-add {
  display: grid;
  width: 64px;
  height: 64px;
  flex: none;
  place-items: center;
  border: 1px dashed var(--brand-border-strong);
  border-radius: 8px;
  padding: 0;
  background: transparent;
  color: var(--brand-muted-strong);
  cursor: pointer;
  transition:
    border-color 140ms ease,
    color 140ms ease;
}
.attachment-add:hover {
  border-color: var(--brand-accent);
  color: var(--brand-accent);
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
  color: var(--brand-accent);
  background: color-mix(in srgb, var(--brand-workspace) 82%, transparent);
  border: 1.5px dashed var(--brand-accent);
  border-radius: 13px;
  pointer-events: none;
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

.permission-lock-hint {
  color: var(--brand-muted-strong);
  font-size: 10px;
  line-height: 14px;
}
.permission-request-inline {
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--brand-warning, #b7791f) 55%, var(--brand-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--brand-warning, #b7791f) 7%, var(--brand-composer));
  padding: 9px 10px;
}
.permission-request-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--brand-foreground);
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
}
.permission-request-details {
  max-height: 72px;
  margin-top: 6px;
  overflow: auto;
  border-radius: 5px;
  background: var(--brand-surface-subtle);
  padding: 6px 7px;
  color: var(--brand-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  line-height: 15px;
  white-space: pre-wrap;
  word-break: break-word;
}
.permission-request-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.permission-request-action {
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--brand-border-strong);
  border-radius: 6px;
  background: transparent;
  padding: 0 9px;
  color: var(--brand-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.permission-request-action:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.permission-request-action.is-primary {
  border-color: var(--brand-primary);
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
}
.permission-request-action.is-primary:hover {
  opacity: 0.9;
}

/* ============ Sender option controls ============ */

/* ============ 下拉弹层（getPopupContainer 挂到 .chat-app 内，brand 变量可用） ============ */

/* 模型菜单 */
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

/* 项目目录菜单同时展示完整路径，便于区分不同位置的同名目录。 */
:global(.project-path-menu) {
  min-width: 260px;
  max-width: min(380px, calc(100vw - 32px));
  max-height: min(360px, 60vh);
  overflow-y: auto;
  padding: 6px;
}

:global(.git-branch-menu) {
  min-width: 180px;
  max-width: min(320px, calc(100vw - 32px));
  max-height: min(360px, 60vh);
  overflow-y: auto;
  padding: 6px;
}
:global(.git-branch-menu .ant-dropdown-menu-item-content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:global(.project-path-menu .ant-dropdown-menu-item-content) {
  min-width: 0;
}
:global(.project-path-menu-row) {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
:global(.project-path-menu-copy) {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}
:global(.project-path-menu-name),
:global(.project-path-menu-location) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:global(.project-path-menu-name) {
  color: var(--brand-foreground);
  font-size: 12px;
  line-height: 16px;
}
:global(.project-path-menu-location) {
  color: var(--brand-muted-strong);
  font-size: 10.5px;
  line-height: 14px;
}
:global(.project-path-menu-remove) {
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: transparent;
  color: var(--brand-muted-strong);
  cursor: pointer;
}
:global(.project-path-menu-remove:hover),
:global(.project-path-menu-remove:focus-visible) {
  background: var(--brand-danger-subtle);
  color: var(--brand-danger);
  outline: none;
}
:global(.project-path-menu .ant-dropdown-menu-item-divider) {
  margin: 4px 0;
}

/* 模型行 */
:global(.model-menu-row) {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
:global(.model-menu-copy) {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}
:global(.model-menu-name) {
  min-width: 0;
  overflow: hidden;
  color: var(--brand-muted);
  font-size: 12px;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:global(.model-menu-provider) {
  overflow: hidden;
  color: var(--brand-ghost);
  font-size: 10px;
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
:global(.sender-option-menu) {
  min-width: 132px;
  padding: 4px;
}
:global(.sender-option-menu .ant-dropdown-menu-item) {
  padding: 5px 8px;
}
:global(.permission-menu-copy) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
:global(.permission-menu-label) {
  color: var(--brand-foreground);
  font-size: 12px;
  font-weight: 500;
  line-height: 15px;
}
:global(.permission-menu-description) {
  max-width: 240px;
  color: var(--brand-muted-strong);
  font-size: 10px;
  line-height: 14px;
  white-space: normal;
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
  .chat-footer.has-bottom-card :deep(.antd-sender-main) {
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

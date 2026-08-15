<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  ChevronDown,
  Cpu,
  FolderOpen,
  Hammer,
  ListTodo,
  ShieldCheck,
  ShieldQuestion,
  Square,
  X,
} from "@lucide/vue";
import { Dropdown, Tooltip, message, type MenuProps } from "antdv-next";
import { computed, h, ref, watch, type Component } from "vue";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import type { PermissionRequest } from "../../services/OpenChatProvider";
import ModelIcon from "../Icons/ModelIcon.vue";
import { aiService } from "../../services/ai";

interface Props {
  modelValue: string;
  loading: boolean;
  currentModel: string;
  currentModelLabel?: string;
  /** 按供应商分组的模型目录 */
  modelCatalog: ModelCatalogEntry[];
  thinkingEnabled: boolean;
  fileModeEnabled: boolean;
  projectPath?: string;
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
  (e: "submit", value: string): void;
  (e: "modelChange", key: string): void;
  (e: "thinkingChange", value: boolean): void;
  (e: "fileModeChange", value: boolean): void;
  (e: "projectPathChange", value: string): void;
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
  mode: "build",
  permission: "supervised",
  permissionLocked: false,
  pendingPermission: null,
  projectPath: "",
  projectPathEnabled: false,
});
const emit = defineEmits<Emits>();
const projectPathPicking = ref(false);

const projectPathName = computed(() => {
  const normalized = String(props.projectPath || "")
    .trim()
    .replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
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
        <div class="flex w-full flex-col gap-2">
          <div v-if="pendingPermission" class="permission-request-inline">
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
          <div class="flex min-h-[26px] w-full items-center justify-between gap-3">
            <!-- composer 左排：推理、工作模式和文件工作区 -->
            <div class="flex min-w-0 items-center gap-[3px]">
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
                  :title="permissionLocked ? 'Pi 供应商固定为完全访问' : '权限策略'"
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
              <div
                v-if="projectPathEnabled"
                class="project-path-control"
                :class="{ 'is-selected': Boolean(projectPath) }"
              >
                <button
                  type="button"
                  :class="[
                    chipClass(Boolean(projectPath), loading || projectPathPicking),
                    { 'project-path-trigger-selected': Boolean(projectPath) },
                  ]"
                  :aria-pressed="Boolean(projectPath)"
                  aria-label="项目工作目录"
                  :title="
                    projectPathPicking ? '等待系统目录选择器' : projectPath || '选择项目工作目录'
                  "
                  :disabled="loading || projectPathPicking"
                  @click="pickProjectPath"
                >
                  <FolderOpen
                    class="!h-[12px] !w-[12px] flex-none"
                    :class="projectPath ? 'text-brand-accent' : 'text-brand-muted-strong'"
                  />
                  <span
                    class="project-path-chip-label"
                    :title="projectPathName || '选择项目工作目录'"
                  >
                    {{ projectPathName || "目录" }}
                  </span>
                </button>
                <Tooltip v-if="projectPath" title="清除项目目录">
                  <button
                    type="button"
                    class="project-path-clear"
                    aria-label="清除项目目录"
                    :disabled="loading || projectPathPicking"
                    @click="clearProjectPath"
                  >
                    <X class="!h-[11px] !w-[11px]" />
                  </button>
                </Tooltip>
              </div>
            </div>

            <!-- composer 右排：模型选择 + 发送 / 停止 -->
            <div class="flex min-w-0 flex-none items-center gap-[6px]">
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

.project-path-control {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 1px;
}
.project-path-control.is-selected {
  border-radius: 6px;
  background: var(--brand-surface-subtle);
}
.project-path-trigger-selected {
  border-radius: 6px 0 0 6px;
  background: transparent;
}
.project-path-clear {
  display: grid;
  width: 20px;
  height: 20px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 4px;
  padding: 0;
  background: transparent;
  color: var(--brand-muted-strong);
  cursor: pointer;
}
.project-path-control.is-selected .project-path-clear {
  border-radius: 0 6px 6px 0;
}
.project-path-clear:hover:not(:disabled) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.project-path-clear:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.project-path-chip-label {
  display: block;
  min-width: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

<script setup lang="ts">
import { AlertTriangle, ShieldCheck, ShieldQuestion } from "@lucide/vue";
import { computed } from "vue";
import type { PermissionRequest } from "../../services/OpenChatProvider";
import { createStyles } from "../../theme/antdvStyle";

interface Props {
  /** 待处理的权限请求；null 时不渲染（外层通常也有 v-else-if 控制）。 */
  request: PermissionRequest | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "response", value: "once" | "always" | "reject"): void;
}>();

const useStyles = createStyles(({ token, css }) => ({
  root: css`
    width: 100%;
    margin-top: 8px;
    border: 1px solid ${token.colorWarningBorder};
    border-radius: 8px;
    background: ${token.colorWarningBg};
    padding: 9px 10px;

    .permission-request-title {
      display: flex;
      align-items: center;
      gap: 7px;
      color: ${token.colorText};
      font-size: 12px;
      font-weight: 600;
      line-height: 16px;
    }
    .permission-request-title-icon {
      width: 14px;
      height: 14px;
      flex: none;
      color: ${token.colorWarning};
    }
    .permission-request-details {
      max-height: 72px;
      margin-top: 6px;
      overflow: auto;
      border-radius: 5px;
      background: ${token.colorFillTertiary};
      padding: 6px 7px;
      color: ${token.colorTextSecondary};
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
      border: 1px solid ${token.colorBorder};
      border-radius: 6px;
      background: transparent;
      padding: 0 9px;
      color: ${token.colorTextSecondary};
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .permission-request-action:hover {
      background: ${token.colorFillTertiary};
      color: ${token.colorText};
    }
    .permission-request-action.is-primary {
      border-color: ${token.colorText};
      background: ${token.colorText};
      color: ${token.colorBgContainer};
    }
    .permission-request-action.is-primary:hover {
      opacity: 0.9;
    }
    .permission-request-action-icon {
      width: 13px;
      height: 13px;
    }
  `,
}));

const { styles } = useStyles();

const pendingPermissionLabel = computed(() => {
  const name = props.request?.permission ?? "";
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
  const request = props.request;
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
  const options = props.request?.options;
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
</script>

<template>
  <div v-if="request" class="permission-request-inline" :class="styles.root">
    <div class="permission-request-title">
      <AlertTriangle class="permission-request-title-icon" />
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
        @click="emit('response', action.response)"
      >
        <ShieldCheck v-if="action.response === 'always'" class="permission-request-action-icon" />
        <ShieldQuestion
          v-else-if="action.response === 'once'"
          class="permission-request-action-icon"
        />
        {{ action.label }}
      </button>
    </div>
  </div>
</template>

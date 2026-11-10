<script setup lang="ts">
import { Bot, Check, ChevronDown, Circle, FolderOpen, GitBranch, X } from "@lucide/vue";
import { Dropdown, Tooltip, type MenuProps } from "antdv-next";
import { computed, h } from "vue";
import { useProjectPathMenu } from "../../composables/useProjectPathMenu";
import type { AgentView } from "../../services/acp";
import type { GitWorkspaceInfo } from "../../services/ai";
import { createStyles } from "../../theme/antdvStyle";
import { projectPathName as folderName } from "../../utils/projectPath";

/**
 * SenderBottomBar：输入卡片下方连成一体的底部行（Sender #bottom slot 内容）。
 *
 * 左 = 供应商（Agent 下拉）、项目工作目录（历史目录菜单 + 清除）、Git 分支（分支菜单 + dirty 标记），
 * 纯展示组件：受控数据经 props 传入，目录选择 / 切换分支 / 刷新等副作用经 emits 上抛；
 * 字面量类名（sender-bottom-row / sender-flat-btn / sender-flat-project 等）由壳层
 * SenderLayout 的样式锚定，移动内容时保持类名不变。
 */
interface Props {
  /** 可选供应商列表（含内置 Model API 项，下拉里过滤掉） */
  agents?: AgentView[];
  /** 当前供应商 id */
  activeAgentId?: string;
  /** 当前项目工作目录 */
  projectPath?: string;
  /** 历史目录（菜单数据源） */
  projectPathOptions?: string[];
  /** 系统目录选择器进行中 */
  projectPathPicking?: boolean;
  /** 会话运行中：目录与分支菜单暂时禁用 */
  loading?: boolean;
  /** Git 工作区状态；null 表示非仓库或未加载 */
  gitWorkspace?: GitWorkspaceInfo | null;
  /** 分支切换进行中 */
  gitBusy?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  agents: () => [],
  activeAgentId: "api",
  projectPath: "",
  projectPathOptions: () => [],
  projectPathPicking: false,
  loading: false,
  gitWorkspace: null,
  gitBusy: false,
});

const emit = defineEmits<{
  (e: "agentChange", agentId: string): void;
  (e: "projectPathChange", value: string): void;
  (e: "projectPathRemove", value: string): void;
  /** 系统目录选择器：副作用在业务侧（useComposerData.handlePickProjectPath）。 */
  (e: "pickProjectPath"): void;
  /** Git 菜单打开等 UI 时机的刷新请求（watch 驱动的刷新在业务侧） */
  (e: "gitWorkspaceRefresh"): void;
  (e: "gitBranchSwitch", branch: string): void;
}>();

const useStyles = createStyles(({ token, css }) => {
  return {
    textAccent: css`
      color: var(--brand-accent);
    `,
    textMutedStrong: css`
      color: var(--brand-muted-strong);
    `,
    /* ===== 下拉弹层：弹层挂 body，样式以各自 rootClass（含本哈希类）为锚 ===== */
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
    agentMenu: css`
      min-width: 220px;
      max-width: min(340px, calc(100vw - 32px));
      max-height: min(360px, 60vh);
      overflow-y: auto;
      padding: 6px;

      .ant-dropdown-menu-item-content {
        min-width: 0;
      }
      .agent-menu-row {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
        padding-left: 2px;
      }
      .agent-menu-copy {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-direction: column;
        gap: 1px;
      }
      .agent-menu-name {
        overflow: hidden;
        color: var(--brand-foreground);
        font-size: 12px;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .agent-menu-status {
        display: flex;
        overflow: hidden;
        align-items: center;
        gap: 5px;
        color: var(--brand-muted-strong);
        font-size: 10.5px;
        line-height: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .agent-menu-check {
        width: 12px;
        height: 12px;
        flex: none;
        color: var(--brand-accent);
        opacity: 0;
        transition: opacity ${token.motionDurationMid} ${token.motionEaseInOut};
      }
      .agent-menu-check.is-visible {
        opacity: 1;
      }
    `,
  };
});

const { styles, cx } = useStyles();

/* ===== 供应商（Agent）下拉：底部行的供应商选择器，列出全部可选供应商 ===== */

const activeAgent = computed(
  () => props.agents.find((agent) => agent.id === props.activeAgentId) ?? null,
);

const agentStatus = (agent: Partial<AgentView>): string => {
  if (!agent.enabled) return "已禁用";
  if (agent.available) return `${agent.protocol || "CLI"} 已就绪`;
  if (agent.installed && agent.protocol === "ACP") return "ACP 适配器未找到";
  return "CLI 未安装";
};

const agentMenu = computed<MenuProps>(() => ({
  rootClass: cx("agent-menu", styles.agentMenu),
  items: props.agents.map((agent) => ({
    key: agent.id,
    label: agent.name,
  })),
  selectable: true,
  selectedKeys: activeAgent.value ? [activeAgent.value.id] : [],
  labelRender: (item) => {
    const agent = props.agents.find((entry) => entry.id === item.key);
    if (!agent) return h("span", null, String(item.label ?? ""));
    const selected = agent.id === props.activeAgentId;
    return h("div", { class: "agent-menu-row", title: agent.description ?? agent.name }, [
      h(Check, {
        class: ["agent-menu-check", { "is-visible": selected }],
        size: 14,
        "aria-hidden": "true",
      }),
      h("span", { class: "agent-menu-copy" }, [
        h("span", { class: "agent-menu-name" }, agent.name),
        h("span", { class: "agent-menu-status" }, [
          h(Circle, {
            class: [
              "!h-[6px] !w-[6px]",
              agent.available
                ? "fill-brand-success text-brand-success"
                : "fill-brand-ghost text-brand-ghost",
            ],
          }),
          agentStatus(agent),
        ]),
      ]),
    ]);
  },
  onClick: ({ key }) => emit("agentChange", String(key)),
}));

const projectPathName = computed(() => folderName(String(props.projectPath || "")));

const projectPathMenu = useProjectPathMenu(
  {
    paths: () => props.projectPathOptions,
    currentPath: () => props.projectPath,
  },
  {
    onSelect: (path) => emit("projectPathChange", path),
    onRemove: (path) => emit("projectPathRemove", path),
    onClear: () => emit("projectPathChange", ""),
    onPick: () => emit("pickProjectPath"),
  },
);

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
</script>

<template>
  <div class="sender-bottom-row">
    <Dropdown
      :menu="agentMenu"
      :trigger="['click']"
      placement="topLeft"
      :disabled="loading || agents.length === 0"
    >
      <button
        type="button"
        class="sender-flat-btn"
        :class="{ 'is-disabled': loading || agents.length === 0 }"
        aria-label="选择供应商"
        :title="activeAgent?.description || activeAgent?.name || '选择供应商'"
        :disabled="loading || agents.length === 0"
      >
        <Bot
          class="!h-[13px] !w-[13px] flex-none"
          :class="activeAgent?.available ? styles.textAccent : styles.textMutedStrong"
        />
        <span class="sender-flat-label">
          {{ activeAgent?.name || "选择供应商" }}
        </span>
        <ChevronDown class="!h-3 !w-3 flex-none" :class="styles.textMutedStrong" />
      </button>
    </Dropdown>

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
          @click="emit('projectPathChange', '')"
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
</template>

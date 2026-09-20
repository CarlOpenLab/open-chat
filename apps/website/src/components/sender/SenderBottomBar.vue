<script setup lang="ts">
import { Check, ChevronDown, FolderOpen, GitBranch, Trash2, X } from "@lucide/vue";
import { Dropdown, Tooltip, type MenuProps } from "antdv-next";
import { computed, h } from "vue";
import type { GitWorkspaceInfo } from "../../services/ai";
import { createStyles } from "../../theme/antdvStyle";
import type { AccentGlobalToken } from "../../theme/shadcnTheme";
import { normalizeDirectoryPath, uniqueDirectoryPaths } from "../../utils/projectPath";

/**
 * SenderBottomBar：输入卡片下方连成一体的底部行（Sender #bottom slot 内容）。
 *
 * 左 = 项目工作目录（历史目录菜单 + 清除），右 = Git 分支（分支菜单 + dirty 标记），
 * 纯展示组件：受控数据经 props 传入，目录选择 / 切换分支 / 刷新等副作用经 emits 上抛；
 * 字面量类名（sender-bottom-row / sender-flat-btn / sender-flat-project 等）由壳层
 * SenderLayout 的样式锚定，移动内容时保持类名不变。
 */
interface Props {
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
  projectPath: "",
  projectPathOptions: () => [],
  projectPathPicking: false,
  loading: false,
  gitWorkspace: null,
  gitBusy: false,
});

const emit = defineEmits<{
  (e: "projectPathChange", value: string): void;
  (e: "projectPathRemove", value: string): void;
  /** 系统目录选择器：副作用在业务侧（useComposerData.handlePickProjectPath）。 */
  (e: "pickProjectPath"): void;
  /** Git 菜单打开等 UI 时机的刷新请求（watch 驱动的刷新在业务侧） */
  (e: "gitWorkspaceRefresh"): void;
  (e: "gitBranchSwitch", branch: string): void;
}>();

const useStyles = createStyles(({ token, css }) => {
  const accent = (token as AccentGlobalToken).colorAccent;
  return {
    textAccent: css`
      color: ${accent};
    `,
    textMutedStrong: css`
      color: ${token.colorTextTertiary};
    `,
    /* ===== 下拉弹层：弹层挂 body，样式以各自 rootClass（含本哈希类）为锚 ===== */
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
        emit("pickProjectPath");
        return;
      }
      const match = String(key).match(/^__path_(\d+)__$/);
      const selected = match ? paths[Number(match[1])] : undefined;
      if (selected) emit("projectPathChange", selected);
    },
  };
});

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

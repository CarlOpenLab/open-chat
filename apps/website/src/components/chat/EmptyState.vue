<script setup lang="ts">
import { Dropdown, message } from "antdv-next";
import { Check, FolderOpen, Trash2, X } from "@lucide/vue";
import { computed, h, ref } from "vue";
import { aiService } from "../../services/ai";
import { normalizeDirectoryPath, uniqueDirectoryPaths } from "../../utils/projectPath";
import OpenChatLogo from "../OpenChatLogo.vue";
import type { MenuProps } from "antdv-next";

interface Props {
  /** 标题中被下划线标注的工作区名（无目录时展示，默认 open-code） */
  projectName?: string;
  /** 副标题，默认不展示 */
  description?: string;
  /** 当前选中的项目目录（由父组件控制，EmptyState 内仅展示与触发选择） */
  projectPath?: string;
  /** 历史目录列表，用于下拉选择 */
  projectPathOptions?: string[];
}

interface Emits {
  (e: "projectPathChange", value: string): void;
  (e: "projectPathRemove", value: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  projectName: "open-code",
  description: "",
  projectPath: "",
  projectPathOptions: () => [],
});

const emit = defineEmits<Emits>();

const projectPathPicking = ref(false);

/** 取路径最后一级作为文件夹名称 */
const pathName = (path: string): string => {
  const normalized = normalizeDirectoryPath(path);
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
};

/** 标题中实际展示的名称：已选目录显示文件夹名，未选显示 open-code / projectName */
const displayName = computed(() => {
  const current = normalizeDirectoryPath(props.projectPath);
  if (current) return pathName(current) || "未命名目录";
  return props.projectName || "open-code";
});

const normalizedProjectPath = computed(() => normalizeDirectoryPath(props.projectPath));

const popupIntoChat = (trigger: HTMLElement) => trigger.closest(".chat-app") ?? document.body;

const projectPathMenu = computed<MenuProps>(() => {
  const paths = uniqueDirectoryPaths(props.projectPathOptions);
  const currentPath = normalizedProjectPath.value;
  const currentIndex = paths.indexOf(currentPath);
  const hasSelection = currentIndex >= 0;

  const pathItems: NonNullable<MenuProps["items"]> = paths.map((path, index) => ({
    key: `__path_${index}__`,
    label: path,
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
    rootClass: "project-path-menu",
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
</script>

<template>
  <div
    class="flex flex-1 flex-col items-center justify-center px-8 pb-[52px] select-none"
    aria-label="空对话欢迎页"
  >
    <span class="grid place-items-center text-brand-foreground" aria-hidden="true">
      <OpenChatLogo :size="36" />
    </span>
    <h1 class="mt-[14px] mb-0 text-[20px] font-medium text-brand-foreground">
      想在
      <Dropdown
        :menu="projectPathMenu"
        trigger="click"
        placement="bottomCenter"
        :get-popup-container="popupIntoChat"
      >
        <button
          type="button"
          class="project-name project-name-interactive"
          :title="normalizedProjectPath || '点击选择项目目录'"
          :aria-label="
            normalizedProjectPath ? `当前目录 ${normalizedProjectPath}，点击切换` : '选择项目目录'
          "
          :aria-busy="projectPathPicking"
        >
          {{ displayName }}
        </button>
      </Dropdown>
      中构建什么？
    </h1>
    <p
      v-if="description"
      class="mt-2 mb-0 max-w-[380px] text-center text-[12.5px] leading-[19px] text-brand-muted-strong"
    >
      {{ description }}
    </p>
    <!-- 已选目录时展示完整路径，未选时给出来源提示 -->
    <p
      v-if="normalizedProjectPath"
      class="mt-1.5 mb-0 max-w-[380px] truncate text-center text-[11px] leading-[14px] text-brand-muted"
      :title="normalizedProjectPath"
    >
      {{ normalizedProjectPath }}
    </p>
    <slot />
  </div>
</template>

<style scoped>
/* 项目名选择器：贴着元素底边的 1px 虚线（dash 1 / gap 2），
   颜色是 text_tertiary。text-decoration 的 dotted 点距不可控，改用背景渐变。 */
.project-name {
  padding: 1px 0 1px;
  background-image: linear-gradient(to right, var(--brand-muted-strong) 0 1px, transparent 1px 3px);
  background-repeat: repeat-x;
  background-position: bottom left;
  background-size: 3px 1px;
}

.project-name-interactive {
  border: 0;
  background-color: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 150ms ease,
    background-image 150ms ease;
}

.project-name-interactive:hover {
  color: var(--brand-accent);
  background-image: linear-gradient(to right, var(--brand-accent) 0 1px, transparent 1px 3px);
}

.project-name-interactive:focus-visible {
  outline: 2px solid var(--brand-accent);
  outline-offset: 2px;
  border-radius: 2px;
}
</style>

<script setup lang="ts">
import { Dropdown, message } from "antdv-next";
import { ChevronDown } from "@lucide/vue";
import { computed, ref } from "vue";
import { useProjectPathMenu } from "../../composables/useProjectPathMenu";
import { aiService } from "../../services/ai";
import { normalizeDirectoryPath, projectPathName } from "../../utils/projectPath";
import OpenChatLogo from "../OpenChatLogo.vue";

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
const projectPathMenuOpen = ref(false);

/** 标题中实际展示的名称：已选目录显示文件夹名，未选显示 open-code / projectName */
const displayName = computed(() => {
  const current = normalizeDirectoryPath(props.projectPath);
  if (current) return projectPathName(current) || "未命名目录";
  return props.projectName || "open-code";
});

const normalizedProjectPath = computed(() => normalizeDirectoryPath(props.projectPath));

const popupIntoChat = (trigger: HTMLElement) => trigger.closest(".chat-app") ?? document.body;

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

const projectPathMenu = useProjectPathMenu(
  {
    paths: () => props.projectPathOptions,
    currentPath: () => props.projectPath,
  },
  {
    onSelect: (path) => emit("projectPathChange", path),
    onRemove: (path) => emit("projectPathRemove", path),
    onClear: () => emit("projectPathChange", ""),
    onPick: () => void pickProjectPath(),
  },
);
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
        :trigger="['click']"
        placement="bottomCenter"
        :get-popup-container="popupIntoChat"
        @open-change="projectPathMenuOpen = $event"
      >
        <button
          type="button"
          class="project-name project-name-interactive"
          :title="normalizedProjectPath || '点击选择项目目录'"
          :aria-label="
            normalizedProjectPath ? `当前目录 ${normalizedProjectPath}，点击切换` : '选择项目目录'
          "
          :aria-busy="projectPathPicking"
          :aria-expanded="projectPathMenuOpen"
          aria-haspopup="menu"
        >
          <span class="project-name-label">{{ displayName }}</span>
          <ChevronDown
            class="project-name-chevron"
            :class="{ 'is-open': projectPathMenuOpen }"
            :size="14"
            aria-hidden="true"
          />
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
/* 项目名选择器：贴着文字底边的 1px 虚线（dash 1 / gap 2），
   颜色是 text_tertiary。text-decoration 的 dotted 点距不可控，改用背景渐变。 */
.project-name {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 0;
  line-height: inherit;
}

.project-name-label {
  background-image: linear-gradient(to right, var(--brand-muted-strong) 0 1px, transparent 1px 3px);
  background-repeat: repeat-x;
  background-position: bottom left;
  background-size: 3px 1px;
  transition: background-image 150ms ease;
}

.project-name-interactive {
  border: 0;
  background-color: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: color 150ms ease;
}

.project-name-interactive:hover {
  color: var(--brand-accent);
}

.project-name-interactive:hover .project-name-label {
  background-image: linear-gradient(to right, var(--brand-accent) 0 1px, transparent 1px 3px);
}

.project-name-chevron {
  flex: none;
  margin-top: 2px;
  color: var(--brand-muted-strong);
  transition:
    transform 150ms ease,
    color 150ms ease;
}

.project-name-interactive:hover .project-name-chevron {
  color: var(--brand-accent);
}

.project-name-chevron.is-open {
  transform: rotate(180deg);
}

.project-name-interactive:focus-visible {
  outline: 2px solid var(--brand-accent);
  outline-offset: 2px;
  border-radius: 2px;
}
</style>

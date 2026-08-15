<script setup lang="ts">
import { Folder, type FolderTreeData, type PreviewFileInfo } from "@antdv-next/x";
import { XMarkdown } from "@antdv-next/x-markdown";
import { FileText, LoaderCircle } from "@lucide/vue";
import { message } from "antdv-next";
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  type Component,
} from "vue";
import type { EditableWorkspaceFile } from "../../utils/fileWorkspace";
import MarkdownCodeRenderer from "./MarkdownCodeRenderer.vue";
import WorkspaceHeaderBar from "./WorkspaceHeaderBar.vue";
import WorkspacePreviewTitle from "./WorkspacePreviewTitle.vue";
import { markdownThemeKey, type MarkdownTheme } from "./markdownTheme";

const WorkspaceCodeEditor = defineAsyncComponent(() => import("./WorkspaceCodeEditor.vue"));

interface Props {
  open: boolean;
  files: EditableWorkspaceFile[];
  pending?: boolean;
  dark: boolean;
  selectedPath?: string[];
  /** 嵌入右侧面板时省略外层 aside/头部/遮罩，只渲染浏览器主体 */
  embedded?: boolean;
}

interface Emits {
  (e: "close"): void;
  (e: "update:selectedPath", path: string[]): void;
  (e: "fileChange", payload: { path: string; content: string }): void;
  (e: "resetFile", path: string): void;
  (e: "acceptIncoming", path: string): void;
}

interface MutableTreeNode extends FolderTreeData {
  children?: MutableTreeNode[];
}

const props = withDefaults(defineProps<Props>(), {
  pending: false,
  selectedPath: () => [],
  embedded: false,
});
const emit = defineEmits<Emits>();
const markdownView = ref<"edit" | "preview">("edit");
const directoryTreeWidth = ref(190);
const markdownTheme = computed<MarkdownTheme>(() => (props.dark ? "dark" : "light"));
const markdownClassName = computed(
  () => `workspace-markdown min-w-0 px-6 pt-5 pb-10 lt-sm:p-4 x-markdown-${markdownTheme.value}`,
);
provide(markdownThemeKey, markdownTheme);

const markdownComponents: Record<string, Component> = {
  code: MarkdownCodeRenderer,
};

const treeData = computed<FolderTreeData[]>(() => {
  const roots: MutableTreeNode[] = [];

  for (const file of props.files) {
    const segments = file.path.split("/");
    let nodes = roots;
    segments.forEach((segment, index) => {
      let node = nodes.find((item) => item.path === segment);
      if (!node) {
        const isFile = index === segments.length - 1;
        node = {
          title: segment,
          path: segment,
          ...(isFile ? { content: file.content } : { children: [] }),
        };
        nodes.push(node);
      }
      if (node.children) nodes = node.children;
    });
  }

  return roots;
});

const selectedFile = computed(() => {
  const selected = props.selectedPath.join("/");
  return props.files.find((file) => file.path === selected);
});
const dirtyFileCount = computed(() => props.files.filter((file) => file.dirty).length);

const resolvePreviewFile = (file: PreviewFileInfo) =>
  props.files.find((item) => item.path === file.path.join("/"));

const isMarkdownFile = (file: Pick<EditableWorkspaceFile, "language" | "path">) =>
  file.language === "md" || file.language === "markdown" || file.path.endsWith(".md");

const copySelectedFile = async () => {
  if (!selectedFile.value) return;
  try {
    await navigator.clipboard.writeText(selectedFile.value.content);
    message.success("文件内容已复制");
  } catch {
    message.warning("无法访问剪贴板");
  }
};

const updateDirectoryTreeWidth = () => {
  directoryTreeWidth.value = window.innerWidth <= 560 ? 112 : window.innerWidth <= 767 ? 145 : 190;
};

onMounted(() => {
  updateDirectoryTreeWidth();
  window.addEventListener("resize", updateDirectoryTreeWidth);
});

onBeforeUnmount(() => window.removeEventListener("resize", updateDirectoryTreeWidth));

const downloadSelectedFile = () => {
  const file = selectedFile.value;
  if (!file) {
    message.info("请先选择文件");
    return;
  }

  const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.path.split("/").at(-1) || "download.txt";
  link.click();
  URL.revokeObjectURL(url);
  message.success("文件已下载");
};
</script>

<template>
  <!-- 嵌入模式：外层布局（aside / 头部 / 遮罩）由 RightPanel 提供 -->
  <template v-if="embedded">
    <div v-if="files.length" class="workspace-browser h-full min-h-0 flex-1 overflow-hidden">
      <Folder
        :key="directoryTreeWidth"
        :tree-data="treeData"
        :selected-file="selectedPath"
        :directory-tree-with="directoryTreeWidth"
        :default-expand-all="true"
        @selected-file-change="emit('update:selectedPath', $event.path)"
      >
        <template #directoryTitle>文件</template>
        <template #previewTitle="{ title, path }">
          <WorkspacePreviewTitle
            v-model:view="markdownView"
            :title="title"
            :file="files.find((item) => item.path === path.join('/'))"
            :markdown="isMarkdownFile(files.find((item) => item.path === path.join('/'))!)"
            @copy="copySelectedFile"
          />
        </template>
        <template #previewRender="{ file }">
          <div v-if="resolvePreviewFile(file)" class="flex h-full min-h-0 w-full flex-col">
            <div class="min-h-0 flex-1 overflow-auto">
              <XMarkdown
                v-if="isMarkdownFile(resolvePreviewFile(file)!) && markdownView === 'preview'"
                :content="resolvePreviewFile(file)?.content ?? ''"
                :components="markdownComponents"
                :class-name="markdownClassName"
                :open-links-in-new-tab="true"
              />
              <WorkspaceCodeEditor
                v-else
                :model-value="resolvePreviewFile(file)?.content ?? ''"
                :language="resolvePreviewFile(file)?.language ?? file.language"
                :dark="dark"
                :read-only="resolvePreviewFile(file)?.status === 'streaming'"
                @update:model-value="
                  emit('fileChange', {
                    path: resolvePreviewFile(file)!.path,
                    content: $event,
                  })
                "
              />
            </div>
          </div>
        </template>
      </Folder>
    </div>

    <div
      v-else
      class="grid min-h-0 flex-1 place-content-center justify-items-center gap-[10px] text-[11px] text-brand-muted"
      role="status"
    >
      <LoaderCircle v-if="pending" class="workspace-spinner !h-5 !w-5" />
      <FileText v-else class="!h-5 !w-5" />
      <span>{{ pending ? "正在生成文件" : "暂无文件" }}</span>
    </div>
  </template>

  <aside
    v-else
    class="file-workspace relative z-24 flex h-[100dvh] flex-col overflow-hidden border-l-solid border-l-brand-border bg-brand-sidebar [transition:width_220ms_ease,min-width_220ms_ease,opacity_180ms_ease,transform_220ms_ease]"
    :class="
      open
        ? 'open w-[clamp(560px,48vw,820px)] min-w-[clamp(560px,48vw,820px)] border-l-1 opacity-100 pointer-events-auto translate-x-0'
        : 'w-0 min-w-0 border-l-0 opacity-0 pointer-events-none translate-x-[18px]'
    "
    :aria-hidden="!open"
    aria-label="文件工作区"
  >
    <WorkspaceHeaderBar
      :file-count="files.length"
      :dirty-count="dirtyFileCount"
      :pending="pending"
      :selected-file="selectedFile"
      @close="emit('close')"
      @download="downloadSelectedFile"
      @accept="emit('acceptIncoming', $event)"
      @reset="emit('resetFile', $event)"
    />

    <div v-if="files.length" class="workspace-browser min-h-0 flex-1 overflow-hidden">
      <Folder
        :key="directoryTreeWidth"
        :tree-data="treeData"
        :selected-file="selectedPath"
        :directory-tree-with="directoryTreeWidth"
        :default-expand-all="true"
        @selected-file-change="emit('update:selectedPath', $event.path)"
      >
        <template #directoryTitle>文件</template>
        <template #previewTitle="{ title, path }">
          <WorkspacePreviewTitle
            v-model:view="markdownView"
            :title="title"
            :file="files.find((item) => item.path === path.join('/'))"
            :markdown="isMarkdownFile(files.find((item) => item.path === path.join('/'))!)"
            @copy="copySelectedFile"
          />
        </template>
        <template #previewRender="{ file }">
          <div v-if="resolvePreviewFile(file)" class="flex h-full min-h-0 w-full flex-col">
            <div class="min-h-0 flex-1 overflow-auto">
              <XMarkdown
                v-if="isMarkdownFile(resolvePreviewFile(file)!) && markdownView === 'preview'"
                :content="resolvePreviewFile(file)?.content ?? ''"
                :components="markdownComponents"
                :class-name="markdownClassName"
                :open-links-in-new-tab="true"
              />
              <WorkspaceCodeEditor
                v-else
                :model-value="resolvePreviewFile(file)?.content ?? ''"
                :language="resolvePreviewFile(file)?.language ?? file.language"
                :dark="dark"
                :read-only="resolvePreviewFile(file)?.status === 'streaming'"
                @update:model-value="
                  emit('fileChange', {
                    path: resolvePreviewFile(file)!.path,
                    content: $event,
                  })
                "
              />
            </div>
          </div>
        </template>
      </Folder>
    </div>

    <div
      v-else
      class="grid min-h-0 flex-1 place-content-center justify-items-center gap-[10px] text-[11px] text-brand-muted"
      role="status"
    >
      <LoaderCircle v-if="pending" class="workspace-spinner !h-5 !w-5" />
      <FileText v-else class="!h-5 !w-5" />
      <span>{{ pending ? "正在生成文件" : "暂无文件" }}</span>
    </div>
  </aside>

  <button
    v-if="!embedded && open"
    class="workspace-scrim hidden"
    type="button"
    aria-label="关闭文件工作区"
    @click="emit('close')"
  ></button>
</template>

<style scoped>
/* 保留：:deep() 覆盖 antd/x Folder 内部类 */
.workspace-browser :deep(.antd-folder) {
  height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.workspace-browser :deep(.antd-folder-directory-tree),
.workspace-browser :deep(.antd-folder-preview) {
  min-width: 0;
}
.workspace-browser :deep(.antd-folder-preview-content) {
  min-height: 0;
  overflow: hidden;
}
/* 保留：@keyframes 动画 */
.workspace-spinner {
  animation: workspace-spin 900ms linear infinite;
}
@keyframes workspace-spin {
  to {
    transform: rotate(360deg);
  }
}
/* 保留：非常规断点 1180px / 767px */
@media (max-width: 1180px) {
  .file-workspace,
  .file-workspace.open {
    position: fixed;
    top: 0;
    right: 0;
    width: min(760px, calc(100% - 48px));
    min-width: 0;
    box-shadow: -18px 0 46px rgba(9, 9, 11, 0.14);
    transform: translateX(102%);
  }
  .file-workspace.open {
    transform: translateX(0);
  }
  .workspace-scrim {
    position: fixed;
    z-index: 23;
    inset: 0;
    display: block;
    padding: 0;
    border: 0;
    background: rgba(9, 9, 11, 0.24);
  }
}
@media (max-width: 767px) {
  .file-workspace,
  .file-workspace.open {
    width: 100%;
  }
}
</style>

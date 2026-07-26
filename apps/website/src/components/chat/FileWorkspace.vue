<script setup lang="ts">
import { Folder, type FolderTreeData, type PreviewFileInfo } from "@antdv-next/x";
import { XMarkdown } from "@antdv-next/x-markdown";
import { Copy, Download, FileText, LoaderCircle, RotateCcw, Sparkles, X } from "@lucide/vue";
import { Segmented, Tooltip, message } from "antdv-next";
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
import { markdownThemeKey, type MarkdownTheme } from "./markdownTheme";

const WorkspaceCodeEditor = defineAsyncComponent(() => import("./WorkspaceCodeEditor.vue"));

interface Props {
  open: boolean;
  files: EditableWorkspaceFile[];
  pending?: boolean;
  dark: boolean;
  selectedPath?: string[];
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
});
const emit = defineEmits<Emits>();
const markdownView = ref<"edit" | "preview">("edit");
const directoryTreeWidth = ref(190);
const markdownTheme = computed<MarkdownTheme>(() => (props.dark ? "dark" : "light"));
const markdownClassName = computed(() => `workspace-markdown x-markdown-${markdownTheme.value}`);
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

const getFileStatusLabel = (file?: EditableWorkspaceFile) => {
  if (file?.hasIncomingChange) return "AI 有新版本";
  if (file?.status === "streaming") return "生成中 · 只读";
  if (file?.dirty) return "已保存";
  return "AI 原始版本";
};

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
  <aside class="file-workspace" :class="{ open }" :aria-hidden="!open" aria-label="文件工作区">
    <header class="workspace-header">
      <div class="workspace-title">
        <FileText />
        <span>
          <strong>文件工作区</strong>
          <small>
            {{ files.length }} 个文件<template v-if="dirtyFileCount">
              · {{ dirtyFileCount }} 项已编辑</template
            >
          </small>
        </span>
        <LoaderCircle v-if="pending" class="workspace-spinner" />
      </div>
      <div class="workspace-actions">
        <Tooltip v-if="selectedFile?.hasIncomingChange" title="采用 AI 新版本">
          <button
            type="button"
            aria-label="采用 AI 新版本"
            @click="emit('acceptIncoming', selectedFile.path)"
          >
            <Sparkles />
          </button>
        </Tooltip>
        <Tooltip v-if="selectedFile?.dirty" title="恢复 AI 版本">
          <button
            type="button"
            aria-label="恢复 AI 版本"
            @click="emit('resetFile', selectedFile.path)"
          >
            <RotateCcw />
          </button>
        </Tooltip>
        <Tooltip title="下载文件">
          <button
            type="button"
            aria-label="下载当前文件"
            :disabled="!selectedFile"
            @click="downloadSelectedFile"
          >
            <Download />
          </button>
        </Tooltip>
        <Tooltip title="关闭文件工作区">
          <button type="button" aria-label="关闭文件工作区" @click="emit('close')"><X /></button>
        </Tooltip>
      </div>
    </header>

    <div v-if="files.length" class="workspace-browser">
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
          <div class="workspace-preview-title">
            <div class="workspace-preview-heading">
              <strong>{{ title }}</strong>
              <span
                class="workspace-file-status"
                :class="{
                  incoming: files.find((item) => item.path === path.join('/'))?.hasIncomingChange,
                  saved: files.find((item) => item.path === path.join('/'))?.dirty,
                }"
              >
                {{ getFileStatusLabel(files.find((item) => item.path === path.join("/"))) }}
              </span>
            </div>
            <div class="workspace-preview-actions">
              <Segmented
                v-if="isMarkdownFile(files.find((item) => item.path === path.join('/'))!)"
                v-model:value="markdownView"
                size="small"
                :options="[
                  { label: '编辑', value: 'edit' },
                  { label: '预览', value: 'preview' },
                ]"
              />
              <Tooltip title="复制文件内容">
                <button type="button" aria-label="复制文件内容" @click="copySelectedFile">
                  <Copy />
                </button>
              </Tooltip>
            </div>
          </div>
        </template>
        <template #previewRender="{ file }">
          <div v-if="resolvePreviewFile(file)" class="workspace-file-view">
            <div class="workspace-editor-content">
              <XMarkdown
                v-if="isMarkdownFile(resolvePreviewFile(file)!) && markdownView === 'preview'"
                :content="resolvePreviewFile(file)?.content ?? ''"
                :components="markdownComponents"
                :class-name="markdownClassName"
                :escape-raw-html="true"
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

    <div v-else class="workspace-empty" role="status">
      <LoaderCircle v-if="pending" class="workspace-spinner" />
      <FileText v-else />
      <span>{{ pending ? "正在生成文件" : "暂无文件" }}</span>
    </div>
  </aside>

  <button
    v-if="open"
    class="workspace-scrim"
    type="button"
    aria-label="关闭文件工作区"
    @click="emit('close')"
  ></button>
</template>

<style scoped>
.file-workspace {
  position: relative;
  z-index: 24;
  display: flex;
  width: 0;
  min-width: 0;
  height: 100dvh;
  flex-direction: column;
  overflow: hidden;
  border-left: 0 solid var(--brand-border);
  background: var(--brand-sidebar);
  opacity: 0;
  pointer-events: none;
  transform: translateX(18px);
  transition:
    width 220ms ease,
    min-width 220ms ease,
    opacity 180ms ease,
    transform 220ms ease;
}
.file-workspace.open {
  width: clamp(560px, 48vw, 820px);
  min-width: clamp(560px, 48vw, 820px);
  border-left-width: 1px;
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}
.workspace-header {
  display: flex;
  height: 58px;
  flex: 0 0 58px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 11px 0 16px;
  border-bottom: 1px solid var(--brand-border);
}
.workspace-title,
.workspace-actions,
.workspace-title > span {
  display: flex;
  min-width: 0;
  align-items: center;
}
.workspace-title {
  gap: 9px;
}
.workspace-title > span {
  flex-direction: column;
  align-items: flex-start;
}
.workspace-title > svg {
  width: 16px;
  height: 16px;
  color: var(--brand-muted);
}
.workspace-title strong {
  font-size: 12px;
}
.workspace-title small {
  color: var(--brand-muted);
  font-size: 9px;
}
.workspace-actions {
  gap: 2px;
}
.workspace-actions button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--brand-muted);
  cursor: pointer;
}
.workspace-actions button:hover:not(:disabled) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.workspace-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.workspace-actions button :deep(svg) {
  width: var(--icon-md);
  height: var(--icon-md);
}
.workspace-browser {
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
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
.workspace-file-view {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}
.workspace-preview-title,
.workspace-preview-heading,
.workspace-preview-actions {
  display: flex;
  min-width: 0;
  align-items: center;
}
.workspace-preview-title {
  width: 100%;
  justify-content: space-between;
  gap: 12px;
}
.workspace-preview-heading {
  gap: 7px;
  overflow: hidden;
}
.workspace-preview-heading strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-file-status {
  flex: 0 0 auto;
  color: var(--brand-muted);
  font-size: 9px;
}
.workspace-file-status.saved {
  color: var(--brand-primary);
}
.workspace-file-status.incoming {
  color: var(--brand-warning, #b7791f);
}
.workspace-preview-actions {
  flex: 0 0 auto;
  gap: 5px;
}
.workspace-preview-actions button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--brand-muted);
  cursor: pointer;
}
.workspace-preview-actions button:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.workspace-preview-actions button :deep(svg) {
  width: 13px;
  height: 13px;
}
.workspace-editor-content {
  min-height: 0;
  flex: 1;
  overflow: auto;
}
.workspace-markdown {
  min-width: 0;
  padding: 20px 24px 40px;
}
.workspace-empty {
  display: grid;
  min-height: 0;
  flex: 1;
  place-content: center;
  justify-items: center;
  gap: 10px;
  color: var(--brand-muted);
  font-size: 11px;
}
.workspace-empty > svg {
  width: 20px;
  height: 20px;
}
.workspace-spinner {
  animation: workspace-spin 900ms linear infinite;
}
.workspace-scrim {
  display: none;
}
@keyframes workspace-spin {
  to {
    transform: rotate(360deg);
  }
}
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
  .workspace-header {
    height: 56px;
    flex-basis: 56px;
  }
  .workspace-actions button {
    width: 44px;
    height: 44px;
  }
}
@media (max-width: 560px) {
  .workspace-title small {
    max-width: 112px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .workspace-markdown {
    padding: 16px;
  }
}
</style>

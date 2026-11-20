<script setup lang="ts">
import {
  CheckOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UndoOutlined,
} from "@antdv-next/icons";
import { Folder } from "@antdv-next/x";
import type { FileContentService, FolderTreeData } from "@antdv-next/x";
import { App, Spin, Tooltip, message } from "antdv-next";
import { computed, h, onBeforeUnmount, ref, watch } from "vue";
import type { VNodeChild } from "vue";
import { api } from "../api";
import { directoryIcons } from "../fileIcons";
import { isDark, store } from "../store";
import type { WorkspaceNode } from "../types";
import CodeEditor from "./CodeEditor.vue";
import TerminalPane from "./TerminalPane.vue";

const props = defineProps<{
  open: boolean;
  cwd: string;
}>();

const emit = defineEmits<{ close: [] }>();

const { modal } = App.useApp();
const termPaneRef = ref<{ createTerminal: () => Promise<void> } | null>(null);
const tree = ref<WorkspaceNode[]>([]);
const loadingTree = ref(false);
const treeError = ref("");
const filterText = ref("");
const selectedFile = ref<string[]>([]);
const expandedPaths = ref<string[]>([]);

// Direct VS Code-style file editor state
const loadingFile = ref(false);
const fileLoadError = ref("");
const draft = ref("");
const originalContent = ref("");
const saving = ref(false);
let loadSeq = 0;

const activeRelPath = computed(() => selectedFile.value.join("/"));
const isDirty = computed(
  () => Boolean(activeRelPath.value) && !loadingFile.value && !fileLoadError.value && draft.value !== originalContent.value,
);

function clearEditorState() {
  loadSeq++;
  loadingFile.value = false;
  fileLoadError.value = "";
  draft.value = "";
  originalContent.value = "";
}

async function loadSelectedFile(relPath: string) {
  if (!relPath || !props.cwd) {
    clearEditorState();
    return;
  }
  const seq = ++loadSeq;
  loadingFile.value = true;
  fileLoadError.value = "";
  draft.value = "";
  originalContent.value = "";
  try {
    const text = await api.workspaceReadFile(props.cwd, relPath);
    if (seq !== loadSeq) return;
    originalContent.value = text;
    draft.value = text;
  } catch (e) {
    if (seq !== loadSeq) return;
    fileLoadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === loadSeq) {
      loadingFile.value = false;
    }
  }
}

watch(
  activeRelPath,
  (relPath) => {
    void loadSelectedFile(relPath);
  },
  { immediate: true },
);

function onSelectedFileChange(file: { path: string[] }) {
  const nextPath = file.path;
  if (nextPath.join("/") === activeRelPath.value) return;
  if (isDirty.value) {
    modal.confirm({
      centered: true,
      title: "放弃未保存的更改？",
      content: `文件 ${activeRelPath.value} 有未保存的编辑，切换将丢失这些更改。`,
      okText: "放弃并切换",
      cancelText: "继续编辑",
      okButtonProps: { danger: true },
      onOk: () => {
        draft.value = originalContent.value;
        selectedFile.value = nextPath;
      },
    });
    return;
  }
  selectedFile.value = nextPath;
}

function revertDraft() {
  if (!isDirty.value) return;
  modal.confirm({
    centered: true,
    title: "撤回未保存的更改？",
    content: "确定恢复到上次保存时的内容吗？",
    okText: "撤回",
    cancelText: "取消",
    okButtonProps: { danger: true },
    onOk: () => {
      draft.value = originalContent.value;
    },
  });
}

async function saveEdit() {
  const rel = activeRelPath.value;
  if (!rel || !isDirty.value || saving.value || fileLoadError.value) return;
  saving.value = true;
  try {
    await api.workspaceWriteFile(props.cwd, rel, draft.value);
    originalContent.value = draft.value;
    message.success(`已保存 ${rel.split("/").pop() || rel}`);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    saving.value = false;
  }
}

async function copyContent() {
  if (loadingFile.value || fileLoadError.value) return;
  try {
    await navigator.clipboard.writeText(draft.value);
    message.success("已复制到剪贴板");
  } catch {
    message.error("复制失败");
  }
}

function renderPreviewTitle(file: { title?: VNodeChild; path: string[] }) {
  const name = file.title || file.path[file.path.length - 1] || "";
  return h("div", { class: "ws-pv-head" }, [
    h("div", { class: "ws-pv-name" }, [
      h("span", { class: "antd-folder-preview-filename", title: file.path.join("/") }, name),
      isDirty.value ? h("span", { class: "ws-pv-dirty", title: "有未保存的更改" }, "• 未保存") : null,
    ]),
    h("div", { class: "ws-pv-acts" }, [
      isDirty.value
        ? h(
            "button",
            {
              type: "button",
              class: "ws-pv-icon-btn",
              title: "撤回更改",
              disabled: saving.value,
              onClick: revertDraft,
            },
            [h(UndoOutlined)],
          )
        : null,
      !loadingFile.value && !fileLoadError.value
        ? h(
            "button",
            {
              type: "button",
              class: ["ws-pv-btn", { primary: isDirty.value }],
              disabled: !isDirty.value || saving.value,
              title: "保存 (⌘S)",
              onClick: () => void saveEdit(),
            },
            [h(CheckOutlined), h("span", saving.value ? "保存中…" : "保存")],
          )
        : null,
      !loadingFile.value && !fileLoadError.value
        ? h(
            "button",
            {
              type: "button",
              class: "ws-pv-icon-btn",
              title: "复制内容",
              onClick: () => void copyContent(),
            },
            [h(CopyOutlined)],
          )
        : null,
    ]),
  ]);
}

function renderPreview() {
  if (loadingFile.value) {
    return h("div", { class: "ws-pv-state" }, [
      h(Spin, { size: "small" }),
      h("span", { class: "ws-pv-state-text" }, "正在加载文件…"),
    ]);
  }
  if (fileLoadError.value) {
    return h("div", { class: "ws-pv-state err" }, [h("span", fileLoadError.value)]);
  }
  return h(CodeEditor, {
    modelValue: draft.value,
    filename: activeRelPath.value,
    dark: isDark.value,
    "onUpdate:modelValue": (v: string) => {
      draft.value = v;
    },
    onSave: () => void saveEdit(),
  });
}

// Instant no-op service: actual file loading & loading spinner are managed directly above
// so Folder never blocks or flashes stale content.
const fileContentService: FileContentService = {
  loadFileContent: async () => "",
};

const shortFolder = computed(() => {
  const parts = props.cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || props.cwd || "~";
});

const treeWidth = computed(() => (store.workspaceWidth < 520 ? 172 : 210));

function filterNodes(nodes: WorkspaceNode[], q: string): WorkspaceNode[] {
  const out: WorkspaceNode[] = [];
  for (const n of nodes) {
    const matchSelf = n.title.toLowerCase().includes(q);
    if (n.children) {
      const sub = matchSelf ? n.children : filterNodes(n.children, q);
      if (matchSelf || sub.length > 0) {
        out.push({ ...n, children: sub });
      }
    } else if (matchSelf) {
      out.push(n);
    }
  }
  return out;
}

const filteredTree = computed<FolderTreeData[]>(() => {
  const q = filterText.value.trim().toLowerCase();
  const list = q ? filterNodes(tree.value, q) : tree.value;
  return list as unknown as FolderTreeData[];
});

async function loadTree() {
  if (!props.cwd) {
    tree.value = [];
    return;
  }
  loadingTree.value = true;
  treeError.value = "";
  try {
    tree.value = await api.workspaceTree(props.cwd);
  } catch (e) {
    treeError.value = e instanceof Error ? e.message : String(e);
    tree.value = [];
  } finally {
    loadingTree.value = false;
  }
}

watch(
  () => [props.open, props.cwd, store.workspaceTab] as const,
  ([open, cwd, tab], prev) => {
    const cwdChanged = prev && prev[1] !== cwd;
    if (cwdChanged) {
      clearEditorState();
      selectedFile.value = [];
      expandedPaths.value = [];
      filterText.value = "";
      tree.value = [];
    }
    if (open && tab === "files" && (cwdChanged || tree.value.length === 0)) {
      void loadTree();
    }
  },
  { immediate: true },
);

async function onNewTerminal() {
  store.workspaceTab = "terminal";
  await termPaneRef.value?.createTerminal();
}

// Drag-to-resize left edge
const resizing = ref(false);
let startX = 0;
let startW = 0;

function onResizeStart(e: PointerEvent) {
  e.preventDefault();
  resizing.value = true;
  startX = e.clientX;
  startW = store.workspaceWidth;
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", onResizeEnd);
}

function onResizeMove(e: PointerEvent) {
  const delta = startX - e.clientX;
  const maxW = Math.min(820, Math.max(420, window.innerWidth - 420));
  store.workspaceWidth = Math.min(maxW, Math.max(340, startW + delta));
}

function onResizeEnd() {
  resizing.value = false;
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", onResizeEnd);
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", onResizeEnd);
});

async function refreshFiles() {
  await loadTree();
  if (!treeError.value) message.success("已刷新文件列表");
}
</script>

<template>
  <aside
    v-show="props.open"
    class="ws-panel"
    :class="{ resizing }"
    :style="{ width: `${store.workspaceWidth}px` }"
  >
    <div class="ws-resizer" title="拖动调整宽度" @pointerdown="onResizeStart" />

    <header class="ws-head">
      <div class="ws-seg" role="tablist" aria-label="工作区视图">
        <button
          type="button"
          role="tab"
          class="ws-seg-btn"
          :class="{ active: store.workspaceTab === 'files' }"
          :aria-selected="store.workspaceTab === 'files'"
          @click="store.workspaceTab = 'files'"
        >
          <FolderOutlined />
          <span>文件</span>
        </button>
        <button
          type="button"
          role="tab"
          class="ws-seg-btn"
          :class="{ active: store.workspaceTab === 'terminal' }"
          :aria-selected="store.workspaceTab === 'terminal'"
          @click="store.workspaceTab = 'terminal'"
        >
          <CodeOutlined />
          <span>终端</span>
        </button>
      </div>

      <span class="ws-cwd mono" :title="props.cwd">{{ shortFolder }}</span>

      <div class="ws-acts">
        <Tooltip v-if="store.workspaceTab === 'files'" title="刷新目录" :mouse-enter-delay="0.35">
          <button type="button" class="ws-ic" :disabled="loadingTree" @click="refreshFiles">
            <ReloadOutlined :spin="loadingTree" />
          </button>
        </Tooltip>
        <Tooltip v-else title="新建终端" :mouse-enter-delay="0.35">
          <button type="button" class="ws-ic" @click="onNewTerminal">
            <PlusOutlined />
          </button>
        </Tooltip>
        <Tooltip title="收起面板" :mouse-enter-delay="0.35">
          <button type="button" class="ws-ic" @click="emit('close')">
            <CloseOutlined />
          </button>
        </Tooltip>
      </div>
    </header>

    <div class="ws-body">
      <!-- Files Tab -->
      <div v-show="store.workspaceTab === 'files'" class="ws-files">
        <div class="ws-filter-bar">
          <SearchOutlined class="ws-filter-ic" />
          <input
            v-model="filterText"
            type="text"
            class="ws-filter-input"
            placeholder="过滤文件名…"
            @keydown.esc="filterText = ''"
          />
          <button v-if="filterText" type="button" class="ws-filter-clear" @click="filterText = ''">
            <CloseOutlined />
          </button>
        </div>

        <div v-if="treeError" class="ws-state err">{{ treeError }}</div>
        <div v-else-if="loadingTree && tree.length === 0" class="ws-state">
          <Spin size="small" />
          <span>正在读取项目文件…</span>
        </div>
        <div v-else class="ws-folder-wrap">
          <Folder
            :selected-file="selectedFile"
            v-model:expanded-paths="expandedPaths"
            class="oc-folder"
            :tree-data="filteredTree"
            :directory-icons="directoryIcons"
            :file-content-service="fileContentService"
            :directory-tree-with="treeWidth"
            :default-expand-all="Boolean(filterText.trim())"
            :directory-title="false"
            :preview-title="renderPreviewTitle"
            :preview-render="renderPreview"
            @selected-file-change="onSelectedFileChange"
          />
        </div>
      </div>

      <!-- Terminal Tab (kept mounted with v-show so running processes stay alive) -->
      <div v-show="store.workspaceTab === 'terminal'" class="ws-term">
        <TerminalPane
          ref="termPaneRef"
          :cwd="props.cwd"
          :visible="props.open && store.workspaceTab === 'terminal'"
        />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.ws-panel {
  flex: none;
  height: 100%;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-left: 1px solid var(--border);
  z-index: 8;
}
.ws-panel.resizing {
  user-select: none;
  -webkit-user-select: none;
}

.ws-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
  cursor: col-resize;
  z-index: 20;
}
.ws-resizer::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  background: transparent;
  transition: background 0.14s;
}
.ws-resizer:hover::after,
.ws-panel.resizing .ws-resizer::after {
  background: var(--border-strong);
}

.ws-head {
  flex: none;
  height: var(--titlebar);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border);
}

.ws-seg {
  display: inline-flex;
  align-items: stretch;
  gap: 16px;
  height: 100%;
  flex: none;
}
.ws-seg-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 2px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.16s var(--ease);
}
.ws-seg-btn::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--text);
  opacity: 0;
  transform: scaleX(0.5);
  transition: opacity 0.16s var(--ease), transform 0.16s var(--ease);
}
.ws-seg-btn:hover:not(.active) {
  color: var(--text-2);
}
.ws-seg-btn.active {
  color: var(--text);
  font-weight: 580;
}
.ws-seg-btn.active::after {
  opacity: 1;
  transform: scaleX(1);
}

.ws-cwd {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.ws-acts {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.ws-ic {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.12s, color 0.12s;
}
.ws-ic:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.ws-ic:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ws-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ws-files,
.ws-term {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ws-filter-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.ws-filter-ic {
  font-size: 12px;
  color: var(--text-3);
  flex: none;
}
.ws-filter-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  line-height: 18px;
}
.ws-filter-input:focus-visible {
  box-shadow: none;
}
.ws-filter-input::placeholder {
  color: var(--text-3);
}
.ws-filter-clear {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: var(--hover);
  color: var(--text-3);
  font-size: 9px;
  cursor: pointer;
}
.ws-filter-clear:hover {
  background: var(--active);
  color: var(--text);
}
.ws-filter-act {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.ws-filter-act:hover {
  background: var(--hover);
  color: var(--text);
}

.ws-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-3);
  padding: 24px;
  text-align: center;
}
.ws-state.err {
  color: var(--err);
}

.ws-folder-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.oc-folder {
  height: 100%;
  width: 100%;
  border: none !important;
  border-radius: 0 !important;
  background: transparent !important;
}
.oc-folder :deep(.antd-folder-container) {
  height: 100%;
  background: transparent !important;
}
.oc-folder :deep(.ant-splitter-bar-dragger::before) {
  background: var(--border) !important;
}
.oc-folder :deep(.ant-splitter-bar-dragger:hover::before),
.oc-folder :deep(.ant-splitter-bar-dragger-active::before) {
  background: var(--border-strong) !important;
}
.oc-folder :deep(.antd-folder-directory-tree) {
  height: 100%;
  background: transparent !important;
  font-size: 12.5px;
}
.oc-folder :deep(.ant-tree) {
  width: 100%;
  background: transparent !important;
  color: var(--text-2);
  font-size: 12px;
}
.oc-folder :deep(.ant-tree-list) {
  width: 100%;
  padding: 6px !important;
}
.oc-folder :deep(.ant-tree-list-holder),
.oc-folder :deep(.ant-tree-list-holder-inner) {
  width: 100%;
}
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode) {
  width: 100%;
  padding: 0 !important;
  margin-bottom: 1px;
  align-items: center;
  border-radius: 5px !important;
  background: transparent !important;
}
.oc-folder :deep(.ant-tree-indent) {
  align-self: stretch;
  display: inline-flex;
}
.oc-folder :deep(.ant-tree-indent-unit) {
  width: 13px !important;
  position: relative;
}
.oc-folder :deep(.ant-tree-indent-unit::before) {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 6px;
  border-left: 1px solid var(--border);
  opacity: 0.75;
}
.oc-folder :deep(.ant-tree-switcher) {
  width: 16px !important;
  min-width: 16px;
  height: 24px;
  line-height: 24px;
  margin-inline-end: 1px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 9px;
}
.oc-folder :deep(.ant-tree-switcher-noop) {
  width: 6px !important;
  min-width: 6px;
}
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode .ant-tree-node-content-wrapper) {
  flex: 1;
  min-width: 0;
  display: flex !important;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  height: 24px;
  line-height: 24px;
  padding: 0 6px 0 2px !important;
  color: var(--text-2);
  background: transparent !important;
  overflow: hidden;
  border-radius: 5px !important;
}
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode .ant-tree-node-content-wrapper::before) {
  border-radius: 5px !important;
  background: transparent !important;
  transition: background-color 0.12s var(--ease), box-shadow 0.12s var(--ease) !important;
}
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode:hover .ant-tree-node-content-wrapper) {
  color: var(--text);
  background: transparent !important;
}
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode:hover .ant-tree-node-content-wrapper::before) {
  background: var(--hover) !important;
}
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode-selected),
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode-selected:hover) {
  background: transparent !important;
}
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode-selected .ant-tree-node-content-wrapper::before),
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode-selected:hover .ant-tree-node-content-wrapper::before) {
  background: color-mix(in srgb, var(--ink) 10%, transparent) !important;
  box-shadow: inset 0 0 0 1px var(--border);
}
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode-selected),
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode-selected .ant-tree-node-content-wrapper),
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode-selected .ant-tree-node-content-wrapper:hover),
.oc-folder :deep(.ant-tree.ant-tree-directory .ant-tree-treenode-selected .ant-tree-switcher) {
  color: var(--text) !important;
}
.oc-folder :deep(.ant-tree-node-selected) {
  font-weight: 500;
  background: transparent !important;
}
.oc-folder :deep(.ant-tree-iconEle) {
  flex: none;
  width: 15px !important;
  height: 24px;
  line-height: 24px;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 13px;
}
.oc-folder :deep(.ws-file-icon) {
  display: block;
  flex: none;
}
.oc-folder :deep(.ws-file-icon-muted) {
  filter: saturate(0.42) brightness(0.96);
  opacity: 0.88;
}
.oc-folder :deep(.ws-minimal-ic) {
  color: var(--text-3);
  font-size: 13px;
}
.oc-folder :deep(.ant-tree-treenode-selected .ws-minimal-ic) {
  color: var(--text);
}
.oc-folder :deep(.ant-tree-title) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.oc-folder :deep(.antd-folder-directory-tree-item-title) {
  overflow: hidden;
  text-overflow: ellipsis;
  padding-inline-end: 8px !important;
}
.oc-folder :deep(.antd-folder-preview) {
  height: 100%;
  background: transparent !important;
}
.oc-folder :deep(.antd-folder-preview-title-wrapper) {
  border-bottom: 1px solid var(--border) !important;
  background: var(--surface-2) !important;
  padding: 7px 12px !important;
}
.oc-folder :deep(.antd-folder-preview-filename) {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-2);
}
.oc-folder :deep(.antd-folder-preview-content) {
  font-size: 12px;
  background: transparent !important;
  padding: 0 !important;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.oc-folder :deep(.antd-folder-preview-empty-container) {
  margin-block-start: 0 !important;
  flex: 1;
  display: grid;
  place-content: center;
}
.oc-folder :deep(.ws-pv-head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 24px;
}
.oc-folder :deep(.ws-pv-name) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.oc-folder :deep(.ws-pv-name .antd-folder-preview-filename) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.oc-folder :deep(.ws-pv-dirty) {
  flex: none;
  font-size: 11px;
  font-weight: 500;
  color: var(--warn);
}
.oc-folder :deep(.ws-pv-acts) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.oc-folder :deep(.ws-pv-btn) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.oc-folder :deep(.ws-pv-btn:hover:not(:disabled)) {
  background: var(--hover);
  color: var(--text);
  border-color: var(--border-strong);
}
.oc-folder :deep(.ws-pv-btn.primary) {
  background: var(--ink);
  color: var(--ink-inv);
  border-color: transparent;
}
.oc-folder :deep(.ws-pv-btn.primary:hover:not(:disabled)) {
  opacity: 0.9;
}
.oc-folder :deep(.ws-pv-btn:disabled) {
  opacity: 0.42;
  cursor: not-allowed;
}
.oc-folder :deep(.ws-pv-icon-btn) {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  font-size: 12.5px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.oc-folder :deep(.ws-pv-icon-btn:hover:not(:disabled)) {
  background: var(--hover);
  color: var(--text);
}
.oc-folder :deep(.ws-pv-icon-btn:disabled) {
  opacity: 0.42;
  cursor: not-allowed;
}
.oc-folder :deep(.ws-pv-state) {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  font-size: 12.5px;
  color: var(--text-3);
  text-align: center;
}
.oc-folder :deep(.ws-pv-state.err) {
  color: var(--err);
}
.oc-folder :deep(.ws-pv-state-text) {
  color: var(--text-3);
}
.oc-folder :deep(.ws-editor) {
  flex: 1;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}
.oc-folder :deep(.ws-editor-gutter) {
  flex: none;
  min-width: 40px;
  padding: 12px 10px 12px 12px;
  border-right: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.64;
  text-align: right;
  color: var(--text-3);
  white-space: pre;
  overflow: hidden;
  user-select: none;
}
.oc-folder :deep(.ws-editor-input) {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 12px 14px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text);
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.64;
  tab-size: 2;
  white-space: pre;
  overflow: auto;
}
.oc-folder :deep(.ws-editor-input:focus-visible) {
  box-shadow: none;
}

.ws-icon-menu {
  width: 212px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ws-icon-menu-title {
  padding: 4px 8px 6px;
  font-size: 11px;
  font-weight: 560;
  color: var(--text-3);
}
.ws-icon-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.ws-icon-opt:hover {
  background: var(--hover);
  color: var(--text);
}
.ws-icon-opt.active {
  background: var(--active);
  color: var(--text);
}
.ws-icon-opt-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.ws-icon-opt-label {
  font-size: 12px;
  font-weight: 520;
  line-height: 1.3;
}
.ws-icon-opt-desc {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.3;
}
.ws-icon-opt-check {
  flex: none;
  font-size: 11.5px;
  color: var(--text);
}
</style>

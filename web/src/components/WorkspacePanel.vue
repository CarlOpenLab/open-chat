<script setup lang="ts">
import {
  CheckOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  ExportOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UndoOutlined,
} from "@antdv-next/icons";
import { Folder } from "@antdv-next/x";
import type { FileContentService, FolderTreeData } from "@antdv-next/x";
import { App, Spin, Tooltip, message } from "antdv-next";
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { VNodeChild } from "vue";
import { api, inApp } from "../api";
import { directoryIcons } from "../fileIcons";
import { isDark, store } from "../store";
import type { WorkspaceFileInfo, WorkspaceNode } from "../types";
import CodeEditor from "./CodeEditor.vue";
import FilePreview, { type RichPreviewKind } from "./FilePreview.vue";
import TerminalPane from "./TerminalPane.vue";

type PreviewKind = RichPreviewKind | "code";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"]);
const VIDEO_EXTS = new Set(["mp4", "m4v", "webm", "mov", "ogv"]);
const MARKDOWN_EXTS = new Set(["md", "markdown", "mdx"]);

function detectPreviewKind(relPath: string): PreviewKind {
  const lower = relPath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "code";
  const ext = lower.slice(dot + 1);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === "svg") return "svg";
  if (MARKDOWN_EXTS.has(ext)) return "markdown";
  if (ext === "pdf") return "pdf";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  return "code";
}

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

// Direct VS Code-style file editor & rich preview state
const loadingFile = ref(false);
const fileLoadError = ref("");
const sourceLoadError = ref("");
const draft = ref("");
const originalContent = ref("");
const fileInfo = ref<WorkspaceFileInfo | null>(null);
const viewMode = ref<"preview" | "source">("preview");
const saving = ref(false);
let loadSeq = 0;

const activeRelPath = computed(() => selectedFile.value.join("/"));
const previewKind = computed<PreviewKind>(() => detectPreviewKind(activeRelPath.value));
const supportsDualMode = computed(() => previewKind.value === "svg" || previewKind.value === "markdown");
const isBinaryMedia = computed(
  () =>
    previewKind.value === "image" ||
    previewKind.value === "pdf" ||
    previewKind.value === "audio" ||
    previewKind.value === "video",
);
const isDirty = computed(
  () =>
    Boolean(activeRelPath.value) &&
    !isBinaryMedia.value &&
    !loadingFile.value &&
    !fileLoadError.value &&
    !sourceLoadError.value &&
    draft.value !== originalContent.value,
);

function clearEditorState() {
  loadSeq++;
  loadingFile.value = false;
  fileLoadError.value = "";
  sourceLoadError.value = "";
  draft.value = "";
  originalContent.value = "";
  fileInfo.value = null;
}

async function loadSelectedFile(relPath: string) {
  if (!relPath || !props.cwd) {
    clearEditorState();
    return;
  }
  const seq = ++loadSeq;
  const kind = detectPreviewKind(relPath);
  loadingFile.value = true;
  fileLoadError.value = "";
  sourceLoadError.value = "";
  draft.value = "";
  originalContent.value = "";
  fileInfo.value = null;
  viewMode.value = kind === "svg" || kind === "markdown" ? "preview" : "source";

  try {
    if (kind === "image" || kind === "pdf" || kind === "audio" || kind === "video") {
      const info = await api.workspaceFileInfo(props.cwd, relPath);
      if (seq !== loadSeq) return;
      fileInfo.value = info;
    } else if (kind === "svg") {
      const [infoRes, textRes] = await Promise.allSettled([
        api.workspaceFileInfo(props.cwd, relPath),
        api.workspaceReadFile(props.cwd, relPath),
      ]);
      if (seq !== loadSeq) return;
      if (infoRes.status === "fulfilled") {
        fileInfo.value = infoRes.value;
      }
      if (textRes.status === "fulfilled") {
        originalContent.value = textRes.value;
        draft.value = textRes.value;
      } else {
        sourceLoadError.value = textRes.reason instanceof Error ? textRes.reason.message : String(textRes.reason);
      }
      if (infoRes.status === "rejected" && textRes.status === "rejected") {
        fileLoadError.value = infoRes.reason instanceof Error ? infoRes.reason.message : String(infoRes.reason);
      }
    } else {
      const text = await api.workspaceReadFile(props.cwd, relPath);
      if (seq !== loadSeq) return;
      originalContent.value = text;
      draft.value = text;
    }
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
  if (!rel || !isDirty.value || saving.value || fileLoadError.value || sourceLoadError.value) return;
  saving.value = true;
  try {
    await api.workspaceWriteFile(props.cwd, rel, draft.value);
    originalContent.value = draft.value;
    message.success(`已保存 ${rel.split("/").pop() || rel}`);
    void loadTree();
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    saving.value = false;
  }
}

async function copyContent() {
  if (loadingFile.value || fileLoadError.value || sourceLoadError.value) return;
  try {
    await navigator.clipboard.writeText(draft.value);
    message.success("已复制到剪贴板");
  } catch {
    message.error("复制失败");
  }
}

async function openExternally() {
  const rel = activeRelPath.value;
  if (!rel) return;
  if (inApp) {
    try {
      await api.openLink(rel, props.cwd);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
    return;
  }
  if (fileInfo.value?.url) {
    window.open(fileInfo.value.url, "_blank", "noopener");
  }
}

type FileCtxAction = "copyPath" | "copyName" | "reveal" | "openExternal" | "refresh";
const fileCtx = ref<{ open: boolean; x: number; y: number; relPath: string; isDir: boolean }>({
  open: false,
  x: 0,
  y: 0,
  relPath: "",
  isDir: false,
});

function closeFileCtx() {
  if (fileCtx.value.open) fileCtx.value.open = false;
}

/** Look up a tree key (a full relative path) in the unfiltered tree. */
function findWorkspaceNode(relPath: string): WorkspaceNode | null {
  let list: WorkspaceNode[] | undefined = tree.value;
  let found: WorkspaceNode | undefined;
  for (const seg of relPath.split("/").filter(Boolean)) {
    found = list?.find((n) => n.path === seg || n.title === seg);
    if (!found) return null;
    list = found.children;
  }
  return found ?? null;
}

function onTreeContextMenu(e: MouseEvent) {
  if (e.shiftKey) return;
  const target = e.target as HTMLElement | null;
  const row = target?.closest<HTMLElement>(".ant-tree-treenode, [role='treeitem']");
  const pathEl =
    target?.closest<HTMLElement>("[data-ws-path]") ??
    row?.querySelector<HTMLElement>("[data-ws-path]");
  const relPath = pathEl?.dataset.wsPath;
  if (!relPath) return;
  e.preventDefault();
  e.stopPropagation();
  const isDir = pathEl.dataset.wsDir === "1" || Boolean(findWorkspaceNode(relPath)?.children);
  const actionCount = 3 + (inApp ? 1 : 0) + (isDir ? 0 : 1);
  fileCtx.value = {
    open: true,
    x: Math.min(e.clientX, window.innerWidth - 160 - 8),
    y: Math.min(e.clientY, window.innerHeight - (actionCount * 32 + 20) - 8),
    relPath,
    isDir,
  };
}

function onFileCtxKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closeFileCtx();
}

async function onFileCtxAction(action: FileCtxAction) {
  const relPath = fileCtx.value.relPath;
  closeFileCtx();
  if (!relPath) return;

  if (action === "copyPath" || action === "copyName") {
    const text = action === "copyPath" ? relPath : relPath.split("/").pop() || relPath;
    try {
      await navigator.clipboard.writeText(text);
      message.success(action === "copyPath" ? "已复制相对路径" : "已复制文件名");
    } catch {
      message.error("复制失败");
    }
    return;
  }

  if (action === "reveal") {
    const base = props.cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const abs = base ? `${base}/${relPath}` : relPath;
    try {
      await api.reveal(abs);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
    return;
  }

  if (action === "openExternal") {
    try {
      if (inApp) {
        await api.openLink(relPath, props.cwd);
      } else {
        const info = await api.workspaceFileInfo(props.cwd, relPath);
        if (info.url) window.open(info.url, "_blank", "noopener");
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
    return;
  }

  void refreshFiles();
}

function renderPreviewTitle(file: { title?: VNodeChild; path: string[] }) {
  const name = file.path[file.path.length - 1] || (typeof file.title === "string" ? file.title : "");
  const showSourceActions =
    !isBinaryMedia.value &&
    !loadingFile.value &&
    !fileLoadError.value &&
    !sourceLoadError.value &&
    (!supportsDualMode.value || viewMode.value === "source" || isDirty.value);

  return h("div", { class: "ws-pv-head" }, [
    h("div", { class: "ws-pv-name" }, [
      h("span", { class: "antd-folder-preview-filename", title: file.path.join("/") }, name),
      isDirty.value ? h("span", { class: "ws-pv-dirty", title: "有未保存的更改" }, "• 未保存") : null,
    ]),
    h("div", { class: "ws-pv-acts" }, [
      supportsDualMode.value && !loadingFile.value && !fileLoadError.value
        ? h("div", { class: "ws-pv-seg", role: "tablist", "aria-label": "预览模式" }, [
            h(
              "button",
              {
                type: "button",
                role: "tab",
                "aria-selected": viewMode.value === "preview",
                class: ["ws-pv-seg-btn", { active: viewMode.value === "preview" }],
                onClick: () => {
                  viewMode.value = "preview";
                },
              },
              "预览",
            ),
            h(
              "button",
              {
                type: "button",
                role: "tab",
                "aria-selected": viewMode.value === "source",
                class: ["ws-pv-seg-btn", { active: viewMode.value === "source" }],
                onClick: () => {
                  viewMode.value = "source";
                },
              },
              "源码",
            ),
          ])
        : null,
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
      showSourceActions
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
      !isBinaryMedia.value && !loadingFile.value && !fileLoadError.value && !sourceLoadError.value
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
      isBinaryMedia.value && !loadingFile.value && !fileLoadError.value && fileInfo.value
        ? h(
            "button",
            {
              type: "button",
              class: "ws-pv-icon-btn",
              title: inApp ? "在访达中显示" : "在新标签页打开",
              onClick: () => void openExternally(),
            },
            [h(ExportOutlined)],
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
  const kind = previewKind.value;
  if (kind !== "code" && (!supportsDualMode.value || viewMode.value === "preview")) {
    return h(FilePreview, {
      kind,
      filename: activeRelPath.value,
      fileInfo: fileInfo.value,
      textContent: draft.value,
    });
  }
  if (sourceLoadError.value) {
    return h("div", { class: "ws-pv-state err" }, [h("span", sourceLoadError.value)]);
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

const viewportWidth = ref(typeof window !== "undefined" ? window.innerWidth : 1200);
const availableMainWidth = computed(() => Math.max(320, viewportWidth.value - (store.sidebarCollapsed ? 0 : 262)));
const maxWorkspaceWidth = computed(() => {
  const avail = availableMainWidth.value;
  const minChat = Math.min(380, Math.floor(avail * 0.48));
  return Math.max(240, avail - minChat);
});
const effectiveWidth = computed(() => Math.min(store.workspaceWidth, maxWorkspaceWidth.value));
const treeWidth = computed(() => (effectiveWidth.value < 400 ? 136 : effectiveWidth.value < 520 ? 172 : 210));

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

function decorateTreeNodes(nodes: WorkspaceNode[], parentPath = ""): FolderTreeData[] {
  return nodes.map((n) => {
    const isDir = Array.isArray(n.children);
    const relPath = parentPath ? `${parentPath}/${n.path}` : n.path;
    const status = n.gitStatus;
    const title: VNodeChild = h(
      "span",
      {
        class: status ? ["ws-tree-label", `is-git-${status.toLowerCase()}`] : "ws-tree-label",
        "data-ws-path": relPath,
        "data-ws-dir": isDir ? "1" : undefined,
      },
      [
        h("span", { class: "ws-tree-name" }, n.title),
        status && !isDir ? h("span", { class: "ws-tree-git-tag" }, status) : null,
      ],
    );
    return {
      title,
      path: n.path,
      children: n.children ? decorateTreeNodes(n.children, relPath) : undefined,
    };
  });
}

const filteredTree = computed<FolderTreeData[]>(() => {
  const q = filterText.value.trim().toLowerCase();
  const list = q ? filterNodes(tree.value, q) : tree.value;
  return decorateTreeNodes(list);
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

function treeHasPath(nodes: WorkspaceNode[], segments: string[]): boolean {
  let list: WorkspaceNode[] | undefined = nodes;
  for (let i = 0; i < segments.length; i++) {
    const hit: WorkspaceNode | undefined = list?.find((n) => n.path === segments[i] || n.title === segments[i]);
    if (!hit) return false;
    if (i === segments.length - 1) return true;
    list = hit.children;
  }
  return false;
}

function revealInTree(segments: string[]) {
  if (!segments.length) return;
  filterText.value = "";
  const parents: string[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    parents.push(segments.slice(0, i + 1).join("/"));
  }
  if (parents.length) {
    const merged = new Set(expandedPaths.value);
    for (const p of parents) merged.add(p);
    expandedPaths.value = Array.from(merged);
  }
  const rel = segments.join("/");
  if (rel === activeRelPath.value) {
    if (!isDirty.value) void loadSelectedFile(rel);
  } else {
    onSelectedFileChange({ path: segments });
  }
  if (props.cwd && !loadingTree.value && !treeHasPath(tree.value, segments)) {
    void loadTree();
  }
}

watch(
  () => store.workspaceReveal,
  (req) => {
    if (!req?.path.length) return;
    const segments = req.path;
    store.workspaceReveal = null;
    revealInTree(segments);
  },
  { immediate: true },
);

watch(
  () => [props.open, props.cwd, store.workspaceTab] as const,
  ([open, cwd, tab], prev) => {
    const cwdChanged = prev && prev[1] !== cwd;
    if (cwdChanged) {
      closeFileCtx();
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
  const maxW = Math.min(820, maxWorkspaceWidth.value);
  const minW = Math.min(340, maxW);
  store.workspaceWidth = Math.min(maxW, Math.max(minW, startW + delta));
}

function onResizeEnd() {
  resizing.value = false;
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", onResizeEnd);
}

function onWindowResize() {
  viewportWidth.value = window.innerWidth;
}

onMounted(() => {
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("pointerdown", closeFileCtx);
  window.addEventListener("blur", closeFileCtx);
  window.addEventListener("keydown", onFileCtxKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onWindowResize);
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", onResizeEnd);
  window.removeEventListener("pointerdown", closeFileCtx);
  window.removeEventListener("blur", closeFileCtx);
  window.removeEventListener("keydown", onFileCtxKeydown);
});

async function refreshFiles() {
  await loadTree();
  if (activeRelPath.value && !isDirty.value) {
    void loadSelectedFile(activeRelPath.value);
  }
  if (!treeError.value) message.success("已刷新文件列表");
}
</script>

<template>
  <aside
    v-show="props.open"
    class="flex-none h-full min-h-0 relative flex flex-col bg-sidebar glass border-0 border-l border-solid border-line z-8"
    :class="{ 'select-none': resizing }"
    :style="{ width: `${effectiveWidth}px` }"
  >
    <div
      class="group/resizer absolute top-0 bottom-0 -left-[3px] w-[6px] cursor-col-resize z-20"
      title="拖动调整宽度"
      @pointerdown="onResizeStart"
    >
      <span
        class="absolute top-0 bottom-0 left-[2px] w-[2px] transition-colors duration-140"
        :class="resizing ? 'bg-line-strong' : 'bg-transparent group-hover/resizer:bg-line-strong'"
      />
    </div>

    <header class="flex-none h-titlebar flex items-center gap-2 pl-[14px] pr-[10px] border-0 border-b border-solid border-line">
      <div class="inline-flex items-stretch gap-4 h-full flex-none" role="tablist" aria-label="工作区视图">
        <button
          type="button"
          role="tab"
          class="relative inline-flex items-center gap-[6px] h-full px-[2px] border-0 bg-transparent text-[12.5px] cursor-pointer transition-colors duration-160 ease-oc"
          :class="store.workspaceTab === 'files' ? 'text-ink fw-580' : 'text-ink-3 font-medium hover:text-ink-2'"
          :aria-selected="store.workspaceTab === 'files'"
          @click="store.workspaceTab = 'files'"
        >
          <FolderOutlined />
          <span>文件</span>
          <span
            class="absolute left-0 right-0 -bottom-[1px] h-[2px] rounded-t-[2px] bg-ink transition-all duration-160 ease-oc"
            :class="store.workspaceTab === 'files' ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'"
          />
        </button>
        <button
          type="button"
          role="tab"
          class="relative inline-flex items-center gap-[6px] h-full px-[2px] border-0 bg-transparent text-[12.5px] cursor-pointer transition-colors duration-160 ease-oc"
          :class="store.workspaceTab === 'terminal' ? 'text-ink fw-580' : 'text-ink-3 font-medium hover:text-ink-2'"
          :aria-selected="store.workspaceTab === 'terminal'"
          @click="store.workspaceTab = 'terminal'"
        >
          <CodeOutlined />
          <span>终端</span>
          <span
            class="absolute left-0 right-0 -bottom-[1px] h-[2px] rounded-t-[2px] bg-ink transition-all duration-160 ease-oc"
            :class="store.workspaceTab === 'terminal' ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'"
          />
        </button>
      </div>

      <span class="flex-1 min-w-0 text-[11px] text-ink-3 truncate text-right font-mono" :title="props.cwd">{{ shortFolder }}</span>

      <div class="inline-flex items-center gap-[2px] flex-none">
        <Tooltip v-if="store.workspaceTab === 'files'" title="刷新目录" :mouse-enter-delay="0.35">
          <button
            type="button"
            class="inline-grid place-items-center w-[26px] h-[26px] border-0 rounded-[7px] bg-transparent text-ink-3 cursor-pointer text-[13px] transition-colors duration-120 hover:not-disabled:bg-hover hover:not-disabled:text-ink disabled:opacity-45 disabled:cursor-not-allowed"
            :disabled="loadingTree"
            @click="refreshFiles"
          >
            <ReloadOutlined :spin="loadingTree" />
          </button>
        </Tooltip>
        <Tooltip v-else title="新建终端" :mouse-enter-delay="0.35">
          <button
            type="button"
            class="inline-grid place-items-center w-[26px] h-[26px] border-0 rounded-[7px] bg-transparent text-ink-3 cursor-pointer text-[13px] transition-colors duration-120 hover:bg-hover hover:text-ink"
            @click="onNewTerminal"
          >
            <PlusOutlined />
          </button>
        </Tooltip>
        <Tooltip title="收起面板" :mouse-enter-delay="0.35">
          <button
            type="button"
            class="inline-grid place-items-center w-[26px] h-[26px] border-0 rounded-[7px] bg-transparent text-ink-3 cursor-pointer text-[13px] transition-colors duration-120 hover:bg-hover hover:text-ink"
            @click="emit('close')"
          >
            <CloseOutlined />
          </button>
        </Tooltip>
      </div>
    </header>

    <div class="flex-1 min-h-0 flex flex-col">
      <!-- Files Tab -->
      <div v-show="store.workspaceTab === 'files'" class="flex-1 min-h-0 flex flex-col">
        <div class="flex-none flex items-center gap-[6px] py-[6px] pr-2 pl-[10px] border-0 border-b border-solid border-line bg-surface-2">
          <SearchOutlined class="text-[12px] text-ink-3 flex-none" />
          <input
            v-model="filterText"
            type="text"
            class="flex-1 min-w-0 border-0 outline-none bg-transparent text-ink text-[12px] leading-[18px] placeholder:text-ink-3 focus-visible:shadow-none"
            placeholder="过滤文件名…"
            @keydown.esc="filterText = ''"
          />
          <button
            v-if="filterText"
            type="button"
            class="inline-grid place-items-center w-4 h-4 border-0 rounded-full bg-hover text-ink-3 text-[9px] cursor-pointer hover:bg-active hover:text-ink"
            @click="filterText = ''"
          >
            <CloseOutlined />
          </button>
        </div>

        <div v-if="treeError" class="flex-1 flex flex-col items-center justify-center gap-2 text-[12.5px] text-err p-6 text-center">
          {{ treeError }}
        </div>
        <div v-else-if="loadingTree && tree.length === 0" class="flex-1 flex flex-col items-center justify-center gap-2 text-[12.5px] text-ink-3 p-6 text-center">
          <Spin size="small" />
          <span>正在读取项目文件…</span>
        </div>
        <div v-else class="flex-1 min-h-0 flex flex-col overflow-hidden">
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
            @contextmenu="onTreeContextMenu"
          />
        </div>
      </div>

      <!-- Terminal Tab (kept mounted with v-show so running processes stay alive) -->
      <div v-show="store.workspaceTab === 'terminal'" class="flex-1 min-h-0 flex flex-col">
        <TerminalPane
          ref="termPaneRef"
          :cwd="props.cwd"
          :visible="props.open && store.workspaceTab === 'terminal'"
        />
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="fileCtx.open"
        class="fixed z-[2100] min-w-[148px] p-[5px] rounded-[11px] bg-surface-strong glass border border-solid border-line-strong shadow-pop flex flex-col gap-[2px] select-none"
        :style="{ left: `${fileCtx.x}px`, top: `${fileCtx.y}px` }"
        @pointerdown.stop
        @contextmenu.prevent.stop
      >
        <button
          type="button"
          class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer inline-flex items-center gap-2 transition-colors duration-120 hover:bg-hover"
          @click="onFileCtxAction('copyPath')"
        >
          <LinkOutlined class="text-[13px] text-ink-3" />
          <span>复制相对路径</span>
        </button>
        <button
          type="button"
          class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer inline-flex items-center gap-2 transition-colors duration-120 hover:bg-hover"
          @click="onFileCtxAction('copyName')"
        >
          <FileTextOutlined class="text-[13px] text-ink-3" />
          <span>复制文件名</span>
        </button>
        <button
          v-if="inApp"
          type="button"
          class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer inline-flex items-center gap-2 transition-colors duration-120 hover:bg-hover"
          @click="onFileCtxAction('reveal')"
        >
          <FolderOpenOutlined class="text-[13px] text-ink-3" />
          <span>在访达中显示</span>
        </button>
        <button
          v-if="!fileCtx.isDir"
          type="button"
          class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer inline-flex items-center gap-2 transition-colors duration-120 hover:bg-hover"
          @click="onFileCtxAction('openExternal')"
        >
          <ExportOutlined class="text-[13px] text-ink-3" />
          <span>{{ inApp ? "用默认程序打开" : "在新标签页打开" }}</span>
        </button>
        <div class="h-[1px] bg-line my-[3px] mx-[6px]" />
        <button
          type="button"
          class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer inline-flex items-center gap-2 transition-colors duration-120 hover:bg-hover"
          @click="onFileCtxAction('refresh')"
        >
          <ReloadOutlined class="text-[13px] text-ink-3" />
          <span>刷新目录</span>
        </button>
      </div>
    </Teleport>
  </aside>
</template>

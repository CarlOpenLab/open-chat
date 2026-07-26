<script setup lang="ts">
import {
  Archive,
  ChevronDown,
  Cloud,
  Download,
  PanelLeftOpen,
  Pencil,
  Pin,
  Share2,
  Trash2,
} from "@lucide/vue";
import { Dropdown, Tooltip, type MenuProps } from "antdv-next";
import { computed, h, nextTick, ref, watch } from "vue";

interface Props {
  title: string;
  sidebarOpen: boolean;
  syncing?: boolean;
}

interface Emits {
  (e: "toggleSidebar"): void;
  (e: "share"): void;
  (e: "export"): void;
  (e: "rename", title: string): void;
  (e: "pin"): void;
  (e: "archive"): void;
  (e: "delete"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const editing = ref(false);
const draftTitle = ref(props.title);
const titleInput = ref<HTMLInputElement>();

watch(
  () => props.title,
  (title) => {
    if (!editing.value) draftTitle.value = title;
  },
);

const beginRename = () => {
  draftTitle.value = props.title;
  editing.value = true;
  void nextTick(() => {
    titleInput.value?.focus();
    titleInput.value?.select();
  });
};

const finishRename = () => {
  if (!editing.value) return;
  editing.value = false;
  emit("rename", draftTitle.value.trim() || "未命名对话");
};

const cancelRename = () => {
  draftTitle.value = props.title;
  editing.value = false;
};

const titleMenu = computed<MenuProps>(() => ({
  items: [
    { key: "rename", label: "重命名", icon: h(Pencil) },
    { key: "pin", label: "置顶对话", icon: h(Pin) },
    { key: "archive", label: "归档对话", icon: h(Archive) },
    { key: "export", label: "导出聊天记录", icon: h(Download) },
    { type: "divider" },
    { key: "delete", label: "删除对话", icon: h(Trash2), danger: true },
  ],
  onClick: ({ key }) => {
    if (key === "rename") beginRename();
    if (key === "pin") emit("pin");
    if (key === "archive") emit("archive");
    if (key === "export") emit("export");
    if (key === "delete") emit("delete");
  },
}));
</script>

<template>
  <header class="chat-header">
    <div class="header-leading">
      <Tooltip v-if="!sidebarOpen" title="展开侧边栏">
        <button
          class="header-icon-button sidebar-open-button"
          type="button"
          aria-label="展开侧边栏"
          @click="emit('toggleSidebar')"
        >
          <PanelLeftOpen />
        </button>
      </Tooltip>
      <span v-if="!sidebarOpen" class="header-divider" aria-hidden="true"></span>
      <input
        v-if="editing"
        ref="titleInput"
        v-model="draftTitle"
        class="title-input"
        aria-label="重命名对话"
        @blur="finishRename"
        @keydown.enter.prevent="finishRename"
        @keydown.esc.prevent="cancelRename"
      />
      <Dropdown v-else :menu="titleMenu" :trigger="['click']">
        <button class="conversation-heading" type="button" aria-label="对话选项">
          <span>{{ title }}</span
          ><ChevronDown />
        </button>
      </Dropdown>
    </div>

    <div class="header-actions" aria-label="对话工具">
      <span class="sync-status" :class="{ saving: syncing }"
        ><Cloud /><span>{{ syncing ? "保存中" : "已同步" }}</span></span
      >
      <button class="header-button" type="button" @click="emit('share')">
        <Share2 /><span>分享</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.chat-header {
  position: relative;
  z-index: 20;
  display: flex;
  min-width: 0;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 16px;
  border-bottom: 1px solid var(--brand-border);
  background: color-mix(in srgb, var(--brand-workspace) 90%, transparent);
  backdrop-filter: blur(16px);
}
.header-leading,
.header-actions {
  display: flex;
  min-width: 0;
  align-items: center;
}
.header-leading {
  gap: 9px;
}
.header-actions {
  gap: 4px;
}
.header-divider {
  width: 1px;
  height: 20px;
  background: var(--brand-border);
}
.header-icon-button {
  display: inline-grid;
  width: 36px;
  min-width: 36px;
  height: 36px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--brand-muted);
  cursor: pointer;
  transition:
    background 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}
.header-icon-button:hover,
.header-icon-button[aria-pressed="true"] {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.header-icon-button:active {
  transform: translateY(1px);
}
.header-icon-button :deep(svg) {
  width: var(--icon-md);
  height: var(--icon-md);
}
.sidebar-open-button,
.header-divider {
  display: none;
}
.conversation-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 2px;
  min-height: 32px;
  padding: 0 4px 0 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--brand-foreground);
  cursor: pointer;
}
.conversation-heading:hover {
  background: var(--brand-surface-subtle);
}
.conversation-heading span {
  max-width: min(38vw, 460px);
  overflow: hidden;
  padding-left: 6px;
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title-input {
  width: min(38vw, 460px);
  height: 32px;
  padding: 0 6px;
  border: 1px solid var(--brand-border-strong);
  border-radius: 5px;
  outline: 0;
  background: var(--brand-surface);
  color: var(--brand-foreground);
  font-size: 13px;
  font-weight: 650;
}
.title-input:focus {
  border-color: var(--brand-foreground);
  box-shadow: 0 0 0 2px var(--brand-ring);
}
.conversation-heading :deep(svg) {
  width: 14px;
  height: 14px;
  color: var(--brand-muted);
}
.sync-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 6px;
  color: var(--brand-muted);
  font-size: 10px;
}
.sync-status :deep(svg) {
  width: 13px;
  height: 13px;
}
.sync-status.saving :deep(svg) {
  animation: soft-pulse 900ms ease-in-out infinite;
}
.header-button {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--brand-muted);
  font-size: 11px;
  font-weight: 580;
  cursor: pointer;
}
.header-button:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.header-button :deep(svg) {
  width: 15px;
  height: 15px;
}
@keyframes soft-pulse {
  50% {
    opacity: 0.35;
  }
}
@media (max-width: 820px) {
  .chat-header {
    min-height: 56px;
    padding: 0 10px;
  }
  .header-icon-button,
  .header-button {
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
  }
  .sidebar-open-button {
    display: inline-grid;
  }
  .header-divider {
    display: block;
  }
  .conversation-heading,
  .title-input {
    min-height: 44px;
  }
  .sync-status {
    display: none;
  }
  .conversation-heading span {
    max-width: 36vw;
  }
}
@media (max-width: 560px) {
  .header-button {
    width: 44px;
    padding: 0;
    justify-content: center;
  }
  .header-button span {
    display: none;
  }
  .conversation-heading span {
    max-width: 42vw;
    font-size: 12px;
  }
}
@media (max-width: 390px) {
  .conversation-heading span {
    max-width: 38vw;
  }
}
</style>

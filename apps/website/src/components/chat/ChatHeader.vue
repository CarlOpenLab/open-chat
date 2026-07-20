<script setup lang="ts">
import { DeleteOutlined, DownloadOutlined, MenuOutlined, UploadOutlined } from "@antdv-next/icons";
import { Tooltip } from "antdv-next";

interface Props {
  title: string;
}

interface Emits {
  (e: "toggleSidebar"): void;
  (e: "clearLocalHistory"): void;
  (e: "exportLocalHistory"): void;
  (e: "importLocalHistory", file: File): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const handleImportChange = (event: Event) => {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;
  emit("importLocalHistory", file);
  input.value = "";
};
</script>

<template>
  <header class="chat-header">
    <div class="header-left">
      <button
        class="icon-button menu-toggle"
        type="button"
        aria-label="切换对话侧栏"
        @click="emit('toggleSidebar')"
      >
        <MenuOutlined />
      </button>
      <div class="header-title">
        <h1>{{ title }}</h1>
      </div>
    </div>

    <div class="header-actions" aria-label="对话工具">
      <Tooltip title="导出日志">
        <button
          class="icon-button"
          type="button"
          aria-label="导出日志"
          @click="emit('exportLocalHistory')"
        >
          <DownloadOutlined />
        </button>
      </Tooltip>

      <Tooltip title="导入日志">
        <label class="icon-button import-button" aria-label="导入日志">
          <UploadOutlined />
          <input
            class="import-input"
            type="file"
            accept="application/json,.json"
            @change="handleImportChange"
          />
        </label>
      </Tooltip>

      <Tooltip title="清空本地记录">
        <button
          class="icon-button danger-button"
          type="button"
          aria-label="清空本地记录"
          @click="emit('clearLocalHistory')"
        >
          <DeleteOutlined />
        </button>
      </Tooltip>
    </div>
  </header>
</template>

<style scoped>
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  padding: 10px var(--chat-gutter);
  background: var(--brand-workspace);
}

.header-left,
.header-actions {
  display: flex;
  align-items: center;
}

.header-left {
  gap: 10px;
  min-width: 0;
}

.header-actions {
  gap: 4px;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--brand-muted-strong);
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}

.icon-button:hover {
  border-color: var(--brand-border);
  background: var(--brand-surface);
  color: var(--brand-foreground);
}

.icon-button:active {
  background: var(--brand-surface-subtle);
  transform: scale(0.97);
}

.header-title {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}

.header-title h1 {
  margin: 0;
  overflow: hidden;
  color: var(--brand-foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.import-button {
  position: relative;
}

.import-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.danger-button:hover {
  border-color: #fecaca;
  background: var(--brand-danger-subtle);
  color: var(--brand-danger);
}

@media (max-width: 767px) {
  .chat-header {
    min-height: 56px;
    padding-inline: 10px;
  }

  .icon-button {
    width: 42px;
    height: 42px;
  }
}
</style>

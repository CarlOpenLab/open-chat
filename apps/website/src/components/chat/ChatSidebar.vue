<script setup lang="ts">
import type { ConversationItemType, ConversationsProps } from "@antdv-next/x";
import { Conversations } from "@antdv-next/x";
import { PlusOutlined } from "@antdv-next/icons";
import { h } from "vue";

interface Props {
  open: boolean;
  conversationList: ConversationItemType[];
  currentKey: string;
}

interface Emits {
  (e: "newConversation"): void;
  (e: "activeChange", key: string): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const handleNewConversation = () => {
  emit("newConversation");
};

const handleActiveChange: ConversationsProps["onActiveChange"] = (key) => {
  emit("activeChange", key);
};

const creationConfig = {
  icon: h(PlusOutlined),
  label: h("span", { class: "antd-conversations-creation-label" }, "新对话"),
  onClick: handleNewConversation,
};
</script>

<template>
  <aside class="chat-sidebar" :class="{ 'is-collapsed': !open }" aria-label="对话列表">
    <div class="sidebar-top">
      <div class="brand-row">
        <span class="brand-mark" aria-hidden="true">O</span>
        <span class="brand-name">Open Chat</span>
      </div>
      <div class="sidebar-label">任务</div>
    </div>
    <Conversations
      :creation="creationConfig"
      :items="conversationList"
      :active-key="currentKey"
      :groupable="true"
      @active-change="handleActiveChange"
    />
  </aside>
</template>

<style scoped>
.chat-sidebar {
  --sidebar-expanded-width: 256px;
  --sidebar-collapsed-width: 64px;
  --sidebar-easing: cubic-bezier(0.2, 0, 0, 1);
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  width: var(--sidebar-expanded-width);
  overflow: hidden;
  border-right: 1px solid #27272a;
  background: var(--brand-sidebar);
  transition:
    width 200ms var(--sidebar-easing),
    border-color 200ms ease;
}

.sidebar-top {
  padding: 18px 12px 14px;
  overflow: hidden;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 36px;
  padding: 0 8px;
  white-space: nowrap;
}

.brand-mark {
  display: inline-flex;
  flex: 0 0 24px;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid #52525b;
  border-radius: 6px;
  background: var(--brand-sidebar-foreground);
  color: var(--brand-sidebar);
  font-size: 12px;
  font-weight: 700;
}

.brand-name {
  overflow: hidden;
  color: var(--brand-sidebar-foreground);
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0;
  transition:
    opacity 150ms ease,
    transform 200ms var(--sidebar-easing);
}

.sidebar-label {
  margin-top: 28px;
  padding: 0 8px;
  color: var(--brand-sidebar-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  transition:
    opacity 150ms ease,
    transform 200ms var(--sidebar-easing);
}

.chat-sidebar :deep(.antd-conversations) {
  min-height: 0;
  flex: 1;
  padding: 0 8px 16px;
  overflow-x: hidden;
}

.chat-sidebar :deep(.antd-conversations-creation) {
  min-height: 42px;
  margin: 0 0 16px;
  border: 1px solid #52525b;
  border-radius: 6px;
  background: var(--brand-sidebar-foreground);
  color: var(--brand-sidebar);
  box-shadow: none;
  font-weight: 600;
  transition:
    background 150ms ease,
    border-color 150ms ease;
}

.chat-sidebar :deep(.antd-conversations-creation:hover) {
  border-color: var(--brand-sidebar-foreground);
  background: #e4e4e7;
}

.chat-sidebar :deep(.antd-conversations-item) {
  min-height: 40px;
  border-radius: 6px;
  color: var(--brand-sidebar-muted);
  transition:
    background 150ms ease,
    color 150ms ease;
}

.chat-sidebar :deep(.antd-conversations-item:hover) {
  background: var(--brand-sidebar-hover);
  color: var(--brand-sidebar-foreground);
}

.chat-sidebar :deep(.antd-conversations-item-active) {
  background: var(--brand-sidebar-active);
  color: var(--brand-sidebar-foreground);
  font-weight: 500;
}

.chat-sidebar :deep(.antd-conversations-group-title) {
  margin-top: 14px;
  padding-inline: 8px;
  color: var(--brand-sidebar-muted);
  font-size: 11px;
  font-weight: 500;
}

.chat-sidebar :deep(.antd-conversations-icon),
.chat-sidebar :deep(.antd-conversations-creation-icon) {
  display: inline-flex;
  flex: 0 0 18px;
  align-items: center;
  justify-content: center;
  width: 18px;
  min-width: 18px;
}

.chat-sidebar :deep(.antd-conversations-label),
.chat-sidebar :deep(.antd-conversations-creation-label),
.chat-sidebar :deep(.antd-conversations-group-title) {
  overflow: hidden;
  max-width: 190px;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    max-width 200ms var(--sidebar-easing),
    opacity 150ms ease;
}

.chat-sidebar.is-collapsed {
  width: var(--sidebar-collapsed-width);
}

.chat-sidebar.is-collapsed .sidebar-top {
  padding-inline: 14px;
}

.chat-sidebar.is-collapsed .brand-row {
  padding-inline: 8px;
}

.chat-sidebar.is-collapsed .brand-name,
.chat-sidebar.is-collapsed .sidebar-label {
  opacity: 0;
  transform: translateX(-6px);
  pointer-events: none;
}

.chat-sidebar.is-collapsed :deep(.antd-conversations-creation),
.chat-sidebar.is-collapsed :deep(.antd-conversations-item) {
  justify-content: center;
  padding-inline: 8px;
}

.chat-sidebar.is-collapsed :deep(.antd-conversations-label),
.chat-sidebar.is-collapsed :deep(.antd-conversations-creation-label),
.chat-sidebar.is-collapsed :deep(.antd-conversations-group-title) {
  max-width: 0;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 767px) {
  .chat-sidebar {
    position: absolute;
    z-index: var(--z-sidebar);
    top: 0;
    bottom: 0;
    left: 0;
    box-shadow: var(--brand-shadow-sm);
  }

  .chat-sidebar.is-collapsed {
    width: 0;
    border-right-color: transparent;
  }
}
</style>

<script setup lang="ts">
/**
 * 会话列表（展示层）：纯对话页左侧的会话导航。
 * 使用 @antdv-next/x 的 Conversations 组件，按日期分组；
 * 状态与操作全部来自 `useWorkspace()`。
 */
import { computed, h } from "vue";
import { Conversations } from "@antdv-next/x";
import type { ConversationItemType } from "@antdv-next/x";
import { Archive, Pin, SquarePen, Trash2 } from "@lucide/vue";
import { message } from "antdv-next";
import { resolveConversationGroup } from "../../utils/sessionDateGroup";
import { useWorkspace } from "../../pages/workspace";

const ws = useWorkspace();

const items = computed<ConversationItemType[]>(() =>
  ws.visibleConversationList.map((conversation) => ({
    key: String(conversation.key),
    label: conversation.label || "新对话",
    group: resolveConversationGroup(conversation.updatedAt, conversation.group),
    timestamp: conversation.updatedAt,
  })),
);

const menu = (conversation: ConversationItemType) => ({
  items: [
    { key: "rename", label: "重命名", icon: h(SquarePen, { class: "!h-[13px] !w-[13px]" }) },
    { key: "pin", label: "置顶 / 取消置顶", icon: h(Pin, { class: "!h-[13px] !w-[13px]" }) },
    { key: "archive", label: "归档", icon: h(Archive, { class: "!h-[13px] !w-[13px]" }) },
    { type: "divider" as const },
    {
      key: "delete",
      label: "删除",
      danger: true,
      icon: h(Trash2, { class: "!h-[13px] !w-[13px]" }),
    },
  ],
  onClick: ({ key }: { key: string | number }) => {
    const conversationKey = String(conversation.key);
    if (key === "rename") {
      const next = window.prompt("重命名对话", String(conversation.label ?? ""));
      if (next && next.trim()) ws.handleSidebarRename(conversationKey, next.trim());
      return;
    }
    if (key === "pin") return ws.handlePinConversation(conversationKey);
    if (key === "archive") {
      ws.handleArchiveConversation(conversationKey);
      message.success("对话已归档");
      return;
    }
    if (key === "delete") return ws.handleDeleteConversation(conversationKey);
  },
});
</script>

<template>
  <aside class="flex min-h-0 w-full flex-1 flex-col overflow-hidden" aria-label="会话列表">
    <Conversations
      class="conversation-list min-h-0 flex-1"
      :items="items"
      :active-key="ws.currentConversationKey"
      :menu="menu"
      groupable
      :creation="{ label: '新对话', onClick: () => ws.handleNewConversation() }"
      @active-change="ws.handleActiveChange($event)"
    />
  </aside>
</template>

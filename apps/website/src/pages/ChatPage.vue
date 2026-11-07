<script setup lang="ts">
/**
 * 对话页（展示层）：纯 AI Chat。
 * 左侧为导航侧栏 + 会话列表，右侧为会话面板；状态来自 `useWorkspace()`。
 */
import ChatSidebar from "../components/chat/ChatSidebar.vue";
import ConversationListPanel from "../components/chat/ConversationListPanel.vue";
import ConversationPanel from "../components/chat/ConversationPanel.vue";
import { useWorkspace } from "./workspace";

const ws = useWorkspace();
</script>

<template>
  <div class="flex h-full min-h-0 overflow-hidden bg-brand-workspace">
    <!-- 侧栏：导航（供应商/新任务） + 会话列表，单列布局 -->
    <div
      class="sidebar-shell relative flex-none overflow-hidden transition-[width] duration-200"
      :style="{ width: ws.conversationsOpen ? `${ws.sidebarWidth}px` : '0px' }"
    >
      <div class="h-full" :style="{ width: `${ws.sidebarWidth}px` }">
        <ChatSidebar
          :open="ws.conversationsOpen"
          :dark="ws.dark"
          :agents="ws.agents"
          :active-agent-id="ws.activeAgentId"
          @toggle-sidebar="ws.handleSidebarToggle()"
          @toggle-theme="ws.toggleTheme()"
          @new-conversation="ws.handleNewConversation()"
          @open-search="ws.openCommandPalette()"
          @open-settings="ws.settingsOpen = true"
          @agent-change="ws.handleAgentChange($event)"
        >
          <ConversationListPanel />
        </ChatSidebar>
      </div>
    </div>

    <!-- 会话面板 -->
    <div class="min-w-0 flex-1">
      <ConversationPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 会话面板（展示层）：头部 + 消息流 + 输入区的固定组合。
 * 状态全部来自 `useWorkspace()`，本组件不持有业务状态；
 * 看板抽屉与对话页共用同一实例结构，保证两处行为一致。
 */
import { useWorkspace } from "../../pages/workspace";
import ChatHeader from "./ChatHeader.vue";
import ChatMessages from "./ChatMessages.vue";
import ChatInput from "./ChatInput.vue";

const ws = useWorkspace();
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <ChatHeader
      :title="ws.currentConversationTitle"
      :sidebar-open="ws.conversationsOpen"
      :right-panel-open="ws.rightPanelOpen"
      :right-panel-available="ws.workspaceAvailable"
      :syncing="ws.isRequesting"
      :can-go-back="ws.historyBack.length > 0"
      :can-go-forward="ws.historyForward.length > 0"
      :diff-added="ws.workspaceDiffStats.added"
      :diff-removed="ws.workspaceDiffStats.removed"
      :show-close="true"
      @toggle-sidebar="ws.handleSidebarToggle()"
      @toggle-right-panel="ws.rightPanelOpen = !ws.rightPanelOpen"
      @export="ws.handleExportLocalHistory()"
      @rename="ws.handleRenameConversation($event)"
      @pin="ws.handlePinConversation(ws.currentConversationKey)"
      @archive="ws.handleArchiveConversation(ws.currentConversationKey)"
      @delete="ws.handleDeleteConversation(ws.currentConversationKey)"
      @close="ws.closeBoardDrawer()"
    />
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <ChatMessages
        :show-welcome="
          ws.showWelcome &&
          ws.currentConversationMessages.length === 0 &&
          !ws.currentConversationBusyState
        "
        :bubble-items="ws.bubbleItems"
        :dark="ws.dark"
        :conversation-key="ws.currentConversationKey"
        :search-results-by-message-id="ws.searchResultsByMessageId"
        :working="Boolean(ws.currentConversationBusyState)"
        :working-started-at-ms="ws.currentConversationBusyState?.startedAt"
        :auto-scroll-mode="ws.autoScrollMode"
        :project-path="ws.projectPath"
        :project-path-options="ws.projectPathOptions"
        @reload="ws.handleReloadMessage($event)"
        @prompt-click="ws.handlePromptClick($event)"
        @project-path-change="ws.handleProjectPathChange($event)"
        @project-path-remove="ws.handleProjectPathRemove($event)"
      />
    </div>
    <ChatInput
      v-model="ws.content"
      :loading="ws.inputRunning"
      :disabled="ws.inputUnavailable"
      :queued-messages="ws.currentQueuedMessages"
      :queue-paused="ws.currentQueuePaused"
      :run-state="ws.acpRunState?.state ?? null"
      :current-model="ws.inputCurrentModel"
      :current-model-label="ws.inputCurrentModelLabel"
      :model-catalog="ws.inputModelCatalog"
      :thinking-enabled="ws.thinkingEnabled"
      :mode="ws.workMode"
      :permission="ws.effectivePermissionMode"
      :permission-locked="ws.isPiAgent"
      :pending-permission="ws.pendingPermission"
      :file-mode-enabled="ws.fileModeEnabled"
      :project-path="ws.projectPath"
      :project-path-options="ws.projectPathOptions"
      :project-path-enabled="ws.projectPathEnabled"
      :agent-mode="ws.isAcpAgent"
      :agent-available="ws.activeAgent.available"
      :agent-configuring="ws.acpSessionLoading"
      :is-oh-my-pi="ws.isPiAgent"
      @change="ws.handleChange($event)"
      @cancel="ws.handleCancel()"
      @submit="
        (value, attachments, commandMeta) => ws.handleSubmit(value, attachments, commandMeta)
      "
      @queued-message-change="(id, content) => ws.handleQueuedMessageChange(id, content)"
      @queued-message-remove="ws.handleQueuedMessageRemove($event)"
      @queued-message-clear="ws.handleQueuedMessageClear()"
      @queued-message-send="ws.handleQueuedMessageSend()"
      @model-change="ws.handleModelChange($event)"
      @thinking-change="ws.handleThinkingChange($event)"
      @mode-change="ws.handleModeChange($event)"
      @permission-change="ws.handlePermissionChange($event)"
      @permission-response="ws.handlePermissionResponse($event)"
      @file-mode-change="ws.handleFileModeChange($event)"
      @project-path-change="ws.handleProjectPathChange($event)"
      @project-path-remove="ws.handleProjectPathRemove($event)"
    />
  </div>
</template>

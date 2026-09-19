<script setup lang="ts">
/**
 * 看板页（展示层）：任务看板为主视图。
 * - 点击卡片 → Notion 式任务抽屉（左任务详情 | 右会话）；
 * - 会话也可以直接以右侧抽屉形态打开；
 * - 状态全部来自 `useWorkspace()`。
 */
import { Drawer } from "antdv-next";
import TaskBoardView from "../components/chat/TaskBoardView.vue";
import TaskDetailDrawer from "../components/chat/TaskDetailDrawer.vue";
import ConversationPanel from "../components/chat/ConversationPanel.vue";
import BoardAssistantDrawer from "../components/board/BoardAssistantDrawer.vue";
import { useWorkspace } from "./workspace";

const ws = useWorkspace();
</script>

<template>
  <div id="chat-content" class="flex h-full min-h-0 flex-col overflow-hidden bg-brand-workspace">
    <TaskBoardView
      :tasks="ws.taskList"
      :conversation-list="ws.conversationList"
      :open-task-id="ws.openTaskId"
      :status-signals="ws.boardStatusSignals"
      :agents="ws.agents"
      :project-path-options="ws.projectPathOptions"
      :current-project-path="ws.projectPath"
      :dark="ws.dark"
      :loading="ws.isHydrating"
      @open-task="ws.handleTaskOpen($event)"
      @move-task="(id, status) => ws.handleTaskMove(id, status)"
      @create-task="ws.handleTaskCreate($event)"
      @update-task-title="(id, title) => ws.handleTaskUpdateTitle(id, title)"
      @archive-task="ws.handleTaskArchive($event)"
      @duplicate-task="ws.handleTaskDuplicate($event)"
      @delete-task="ws.handleTaskDelete($event)"
      @toggle-theme="ws.toggleTheme()"
      @open-settings="ws.settingsOpen = true"
    />
  </div>

  <!-- 任务抽屉：split 模式 左任务｜右对话（新建/打开会话同屉） -->
  <TaskDetailDrawer
    :open="Boolean(ws.openTaskId)"
    :task="ws.currentTask"
    :conversation-list="ws.conversationList"
    :status-signals="ws.boardStatusSignals"
    :now-tick="ws.taskNowTick"
    :split="true"
    :active-session-key="ws.boardOpenKey"
    :project-path-options="ws.projectPathOptions"
    :agents="ws.agents"
    :active-agent-id="ws.activeAgentId"
    @close="ws.closeTaskDrawer()"
    @update-task="(id, patch) => ws.handleTaskUpdate(id, patch)"
    @create-session="ws.handleCreateSessionForTask($event)"
    @open-session="ws.handleOpenSessionFromTask($event)"
    @retry-session="(taskId, sessionKey) => ws.handleRetrySessionForTask(taskId, sessionKey)"
    @remove-session-link="(taskId, sessionKey) => ws.handleRemoveSessionLink(taskId, sessionKey)"
    @delete-session="ws.handleDeleteConversation($event)"
    @agent-change="ws.handleAgentChange($event)"
    @rename-session="(sessionKey, title) => ws.handleSidebarRename(sessionKey, title)"
  >
    <template #chat>
      <ConversationPanel v-if="ws.boardOpenKey" />
    </template>
  </TaskDetailDrawer>

  <!-- 会话抽屉：仅当未打开任务时（看板卡片直接打开会话） -->
  <Drawer
    v-if="!ws.openTaskId"
    class="board-drawer"
    :open="Boolean(ws.boardOpenKey)"
    placement="right"
    :width="ws.drawerWidth"
    :keyboard="true"
    :body-style="{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }"
    :header-style="{ display: 'none' }"
    destroy-on-close
    @close="ws.closeBoardDrawer()"
  >
    <ConversationPanel v-if="ws.boardOpenKey" />
  </Drawer>

  <!-- 看板 AI 助手：悬浮按钮 + 聊天抽屉 -->
  <BoardAssistantDrawer :agents="ws.agents" @tasks-mutated="ws.refreshTasksFromServer()" />
</template>

<style scoped>
/* 抽屉内右面板：覆盖在消息流之上 */
:deep(.board-drawer .ant-drawer-body) {
  position: relative;
}

/* 移动端：抽屉全屏，避免 560+ 宽度在窄屏溢出 */
@media (max-width: 768px) {
  :deep(.board-drawer) {
    width: 100vw !important;
    max-width: 100vw !important;
  }
}
</style>

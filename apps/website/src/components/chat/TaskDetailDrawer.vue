<script setup lang="ts">
import { Folder, Plus } from "@lucide/vue";
import { Button, Drawer } from "antdv-next";
import { computed } from "vue";
import type { OpenChatConversation } from "../../composables/useChatPersistence";
import type { AgentView } from "../../services/acp";
import type { Task } from "../../services/taskStorage";
import { createStyles } from "../../theme/antdvStyle";
import type { SessionStatusSignals } from "../../utils/sessionStatus";
import TaskDetailForm from "./TaskDetailForm.vue";
import TaskSessionList from "./TaskSessionList.vue";

interface Props {
  open: boolean;
  task: Task | null;
  conversationList: OpenChatConversation[];
  statusSignals: SessionStatusSignals;
  nowTick: number;
  split?: boolean;
  activeSessionKey?: string;
  projectPathOptions?: string[];
  agents?: AgentView[];
  activeAgentId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  split: false,
  activeSessionKey: "",
  projectPathOptions: () => [],
  agents: () => [],
  activeAgentId: "api",
});
const emit = defineEmits<{
  (e: "close"): void;
  (e: "updateTask", id: string, patch: Partial<Task>): void;
  (e: "createSession", taskId: string): void;
  (e: "openSession", sessionKey: string): void;
  (e: "retrySession", taskId: string, sessionKey: string): void;
  (e: "removeSessionLink", taskId: string, sessionKey: string): void;
  (e: "deleteSession", sessionKey: string): void;
  (e: "agentChange", agentId: string): void;
  (e: "renameSession", sessionKey: string, title: string): void;
}>();

const useStyles = createStyles(({ token, css }) => ({
  // 仅非 split 兼容分支的会话行表面；split 分支同一套表面由 TaskSessionRow 自持
  sessionRow: css`
    background: var(--card, #ffffff);
    border: 1px solid var(--border);
    border-radius: ${token.borderRadiusLG}px;
    transition: all ${token.motionDurationMid} ${token.motionEaseInOut};
    &:hover {
      border-color: var(--border-strong);
      background: var(--fill-faint);
    }
  `,
}));

const { styles } = useStyles();

const sessionList = computed(() => {
  if (!props.task) return [];
  const map = new Map<string, OpenChatConversation>();
  for (const c of props.conversationList) map.set(String(c.key), c);
  return props.task.sessionKeys
    .map((k) => map.get(k))
    .filter((c): c is OpenChatConversation => Boolean(c))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
});

const handleCreateSession = () => {
  if (!props.task) return;
  emit("createSession", props.task.id);
};

const handleTaskPatch = (patch: Partial<Task>) => {
  if (!props.task) return;
  emit("updateTask", props.task.id, patch);
};

const handleOpenSession = (sessionKey: string) => {
  emit("openSession", sessionKey);
};

const handleDeleteSession = (sessionKey: string) => {
  emit("deleteSession", sessionKey);
};

const handleRenameSession = (sessionKey: string, title: string) => {
  emit("renameSession", sessionKey, title);
};

const handleAgentChange = (agentId: string) => {
  emit("agentChange", agentId);
};

const projectName = computed(() => {
  const p = props.task?.projectPath;
  return p ? (p.split(/[\\/]/).filter(Boolean).pop() ?? p) : "未关联项目";
});

const handlePickDirectory = async () => {
  try {
    const { aiService } = await import("../../services/ai");
    const res = await aiService.pickProjectPath();
    if (res?.path && props.task) emit("updateTask", props.task.id, { projectPath: res.path });
  } catch {
    // ignore
  }
};
</script>

<template>
  <Drawer
    :open="open"
    placement="right"
    :width="split ? 980 : 560"
    :keyboard="true"
    :body-style="{ padding: '0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }"
    :header-style="{ display: 'none' }"
    destroy-on-close
    @close="emit('close')"
  >
    <template v-if="task">
      <!-- Split 模式：左任务｜右对话 -->
      <div v-if="split" class="flex h-100vh min-h-0">
        <!-- 左：任务信息 -->
        <div
          class="w-90 flex-none border-r border-border overflow-auto flex flex-col bg-background"
        >
          <header
            class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0"
          >
            <span
              class="inline-flex items-center gap-1.5 text-12px text-muted-foreground"
              :title="task.projectPath ?? ''"
            >
              <Folder class="!h-3 !w-3" /> {{ projectName }}
            </span>
            <Button type="text" size="small" @click="emit('close')">×</Button>
          </header>

          <div class="flex-1 overflow-auto p-4 flex flex-col gap-4">
            <TaskDetailForm
              :task="task"
              :project-path-options="projectPathOptions"
              @patch="handleTaskPatch"
              @pick-directory="handlePickDirectory"
            />

            <TaskSessionList
              :sessions="sessionList"
              :status-signals="statusSignals"
              :now-tick="nowTick"
              :active-session-key="activeSessionKey"
              :agents="agents"
              :active-agent-id="activeAgentId"
              @create-session="handleCreateSession"
              @open-session="handleOpenSession"
              @delete-session="handleDeleteSession"
              @rename-session="handleRenameSession"
              @agent-change="handleAgentChange"
            />
          </div>
        </div>

        <!-- 右：AI Chat -->
        <div class="flex-1 flex flex-col min-w-0 bg-background">
          <slot name="chat">
            <div class="flex-1 grid place-items-center p-8 text-center">
              <div class="flex flex-col items-center gap-3 max-w-sm">
                <div class="h-10 w-10 rounded-full bg-muted grid place-items-center">
                  <Plus class="h-5 w-5 text-muted-foreground" />
                </div>
                <div class="text-14px font-medium">在左侧选择或新建会话</div>
                <div class="text-12px text-muted-foreground leading-5">
                  会话将在此展示，任务信息保持在左侧，不用来回切换抽屉
                </div>
              </div>
            </div>
          </slot>
        </div>
      </div>

      <!-- 非 split 兼容 -->
      <div v-else class="flex flex-col h-100vh bg-background">
        <header class="flex items-center justify-between px-4 py-3 border-b border-border">
          <span class="inline-flex items-center gap-1.5 text-12px text-muted-foreground">
            <Folder class="!h-3 !w-3" /> {{ projectName }}
          </span>
          <Button type="text" size="small" @click="emit('close')">×</Button>
        </header>
        <div class="flex-1 overflow-auto p-4 flex flex-col gap-4">
          <TaskDetailForm compact :task="task" @patch="handleTaskPatch" />
          <div
            v-for="conv in sessionList"
            :key="String(conv.key)"
            :class="['p-2.5', styles.sessionRow]"
            @click="emit('openSession', String(conv.key))"
          >
            {{ conv.label }}
          </div>
        </div>
      </div>
    </template>
  </Drawer>
</template>

<style scoped>
/* 移动端：任务抽屉全屏，split 双栏纵向堆叠 */
@media (max-width: 900px) {
  :deep(.ant-drawer-content-wrapper) {
    width: 100vw !important;
    max-width: 100vw !important;
  }
  .h-100vh {
    flex-direction: column;
    height: 100%;
  }
  .h-100vh > .w-90 {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}
</style>

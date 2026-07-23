<script setup lang="ts">
import type { BubbleItemType, ConversationItemType, ConversationsProps } from "@antdv-next/x";
import type { ActionPayload } from "@antdv-next/x-card";
import type { DefaultMessageInfo } from "@antdv-next/x-sdk";
import type { XModelMessage, XModelParams, XModelResponse } from "@antdv-next/x-sdk";
import { XRequest, useXChat } from "@antdv-next/x-sdk";
import { Copy, Download, FileText, Link2, Plus, Trash2, X } from "@lucide/vue";
import { Button, Input, Modal, Switch, message, type MenuProps } from "antdv-next";
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { aiService, API_BASE_URL, GATEWAY_API_KEY, type ModelsProvider } from "../services/ai";
import { OpenChatProvider } from "../services/OpenChatProvider";
import {
  clearChatState,
  loadChatState,
  normalizePersistedChatState,
  saveChatState,
  type PersistedChatState,
  type PersistedConversation,
} from "../services/chatStorage";
import ChatSidebar from "./chat/ChatSidebar.vue";
import ChatHeader from "./chat/ChatHeader.vue";
import ChatMessages from "./chat/ChatMessages.vue";
import ChatInput from "./chat/ChatInput.vue";

interface Props {
  dark: boolean;
}

interface Emits {
  (e: "navigate", path: string): void;
  (e: "toggleTheme"): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

// ============ 响应式状态 ============

const models = ref<ModelsProvider[]>([]);
const defaultModelId = ref("");
const content = ref("");
const conversationsOpen = ref(true);
const contextOpen = ref(false);
const shareOpen = ref(false);
const deleteOpen = ref(false);
const allowSharedCopy = ref(true);
const memoryEnabled = ref(true);
const currentConversationKey = ref<string>("");
const currentModel = ref("");
const thinkingEnabled = ref(true);
const pendingA2UISurfaceId = ref("");
const showWelcome = ref(true);
const isHydrating = ref(true);
const activeRequestConversationKey = ref<string>("");
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const getMessagePreview = (content: string, maxLength: number = 20): string => {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "新对话";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

const createNewConversation = (): ConversationItemType => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  label: "新对话",
  group: "今天",
  messages: [],
});

const conversationList = ref<ConversationItemType[]>([]);

const toPersistedConversations = (list: ConversationItemType[]): PersistedConversation[] => {
  return list
    .filter((conversation) => {
      const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
      return messages.length > 0;
    })
    .map((conversation, index) => {
      const normalizedLabel =
        typeof conversation.label === "string" && conversation.label.trim()
          ? conversation.label
          : "新对话";
      const normalizedGroup = typeof conversation.group === "string" ? conversation.group : "今天";

      const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
      const normalizedMessages = messages.map((item, messageIndex) => {
        const fallbackId = `${Date.now()}-${index}-${messageIndex}`;
        return {
          id: item.id ?? fallbackId,
          status: item.status,
          message:
            typeof item.message === "object" && item.message !== null
              ? { ...item.message }
              : ({ role: "assistant", content: String(item.message ?? "") } as XModelMessage),
          ...(item.extraInfo ? { extraInfo: item.extraInfo } : {}),
        };
      });

      return {
        key: String(conversation.key),
        label: normalizedLabel,
        group: normalizedGroup,
        messages: normalizedMessages,
      };
    });
};

// ============ 计算属性 ============

const allModelIds = computed(() =>
  models.value.flatMap((provider) => provider.models.map((model) => model.id)),
);

const modelById = computed<Record<string, { id: string; name: string; provider: string }>>(() => {
  const map: Record<string, { id: string; name: string; provider: string }> = {};
  for (const provider of models.value) {
    for (const model of provider.models) {
      map[model.id] = {
        id: model.id,
        name: model.name || model.id,
        provider: provider.name,
      };
    }
  }
  return map;
});

const modelOptions = computed(() =>
  models.value.flatMap((provider) =>
    provider.models.map((model) => ({
      label: model.name || model.id,
      value: model.id,
    })),
  ),
);

const modelDropdownItems = computed<MenuProps["items"]>(() => {
  return modelOptions.value.map((opt) => ({
    key: opt.value,
    label: opt.label,
  }));
});

const currentModelLabel = computed(
  () => modelById.value[currentModel.value]?.name || currentModel.value || "选择模型",
);

function reconcileCurrentModel() {
  if (allModelIds.value.length === 0) return;
  if (!currentModel.value || !allModelIds.value.includes(currentModel.value)) {
    currentModel.value = defaultModelId.value || allModelIds.value[0];
  }
}

// ============ 对话管理 ============

const getCurrentConversation = (): ConversationItemType | undefined => {
  return conversationList.value.find((c) => c.key === currentConversationKey.value);
};

const isInDraftMode = computed(() => !currentConversationKey.value);
const currentConversationTitle = computed(() => {
  const conversation = getCurrentConversation();
  return typeof conversation?.label === "string" && conversation.label.trim()
    ? conversation.label
    : "新对话";
});
const currentConversationMessages = computed<DefaultMessageInfo<XModelMessage>[]>(() => {
  const conv = getCurrentConversation();
  return conv?.messages ?? [];
});

const updateConversationMessages = (
  conversationKey: string,
  newMessages: DefaultMessageInfo<XModelMessage>[],
) => {
  if (!conversationKey) return;
  const conv = conversationList.value.find((c) => c.key === conversationKey);
  if (!conv) return;

  conv.messages = newMessages;

  // 如果有消息，更新对话标题为首条用户消息摘要
  if (newMessages.length > 0 && conv.label === "新对话") {
    const firstUserMessage = newMessages.find((m) => m.message.role === "user");
    if (firstUserMessage) {
      const contentStr =
        typeof firstUserMessage.message.content === "string"
          ? firstUserMessage.message.content
          : "";
      conv.label = getMessagePreview(contentStr);
    }
  }
};

const handleNewConversation = () => {
  // 草稿态下重复点击只提示，不重复创建
  if (isInDraftMode.value) {
    showWelcome.value = true;
    message.info("当前已经是新对话");
    return;
  }

  currentConversationKey.value = "";
  showWelcome.value = true;
};

const handleActiveChange: ConversationsProps["onActiveChange"] = (key) => {
  currentConversationKey.value = key;
  const conv = getCurrentConversation();
  if (conv) {
    showWelcome.value = conv.messages.length === 0;
  }
  if (window.matchMedia("(max-width: 767px)").matches) {
    closeSidebar();
  }
};

const handleSidebarToggle = () => {
  conversationsOpen.value = !conversationsOpen.value;
};

const closeSidebar = () => {
  conversationsOpen.value = false;
};

const resetToDraftConversation = () => {
  activeRequestConversationKey.value = "";
  conversationList.value = [];
  currentConversationKey.value = "";
  showWelcome.value = true;
};

const applyPersistedState = (persistedState: PersistedChatState) => {
  conversationList.value = persistedState.conversationList.map((conv) => {
    if (conv.label === "默认对话") {
      if (conv.messages?.length) {
        const firstUserMessage = conv.messages.find((m) => m.message.role === "user");
        if (firstUserMessage && typeof firstUserMessage.message.content === "string") {
          return { ...conv, label: getMessagePreview(firstUserMessage.message.content) };
        }
      }
      return { ...conv, label: "新对话" };
    }
    return {
      ...conv,
      key: String(conv.key),
      label: typeof conv.label === "string" && conv.label.trim() ? conv.label : "新对话",
    };
  });
  currentModel.value = persistedState.currentModel;
  reconcileCurrentModel();

  // 导入后保持草稿态，历史会话保留在侧栏供手动打开
  currentConversationKey.value = "";
  setMessages([]);
  showWelcome.value = true;
};

const handleClearLocalHistory = async () => {
  const confirmed = window.confirm("确定清空本地聊天记录吗？此操作不可恢复。");
  if (!confirmed) return;

  if (isRequesting.value) {
    message.warning("回答生成中，请先手动停止后再清空历史");
    return;
  }

  await clearChatState();
  resetToDraftConversation();
};

const schedulePersistState = () => {
  if (isHydrating.value) return;

  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    const state = {
      version: 1 as const,
      currentConversationKey: currentConversationKey.value,
      currentModel: currentModel.value,
      conversationList: toPersistedConversations(conversationList.value),
    };
    void saveChatState(state);
  }, 250);
};

const handleExportLocalHistory = () => {
  const state: PersistedChatState = {
    version: 1,
    currentConversationKey: currentConversationKey.value,
    currentModel: currentModel.value,
    conversationList: toPersistedConversations(conversationList.value),
  };
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const link = document.createElement("a");
  link.href = url;
  link.download = `open-chat-logs-${timestamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
  message.success("日志导出成功");
};

const handleImportLocalHistory = async (file: File) => {
  if (!file.name.toLowerCase().endsWith(".json")) {
    message.error("仅支持导入 JSON 日志文件");
    return;
  }

  const shouldOverwrite = window.confirm("导入会覆盖当前本地聊天记录，是否继续？");
  if (!shouldOverwrite) return;

  try {
    const text = await file.text();
    const raw = JSON.parse(text) as unknown;
    const importedState = normalizePersistedChatState(raw);

    if (!importedState) {
      message.error("日志文件格式不正确，导入失败");
      return;
    }

    if (isRequesting.value) {
      message.warning("回答生成中，请先手动停止后再导入日志");
      return;
    }

    applyPersistedState(importedState);
    await saveChatState({
      ...importedState,
      currentConversationKey: "",
      conversationList: toPersistedConversations(conversationList.value),
    });
    message.success(`日志导入成功，共 ${conversationList.value.length} 条会话`);
  } catch (error) {
    console.error("Failed to import chat history:", error);
    message.error("日志导入失败，请检查文件内容");
  }
};

// ============ 模型加载 ============

const loadModels = async () => {
  try {
    const data = await aiService.getModels();
    models.value = data.providers;
    defaultModelId.value = data.defaultModel;
    reconcileCurrentModel();
  } catch (e) {
    console.error("Failed to load models:", e);
  }
};

loadModels();

// ============ XChat 配置 ============

const createProvider = () => {
  return new OpenChatProvider({
    request: XRequest<XModelParams, XModelResponse>(`${API_BASE_URL}/api/chat/completions`, {
      manual: true,
      params: { stream: true } as XModelParams,
      headers: GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : undefined,
      streamTimeout: 60000,
    }),
  });
};

const provider = createProvider();

const getInitialMessages = (): DefaultMessageInfo<XModelMessage>[] => {
  const conv = getCurrentConversation();
  return conv?.messages || [];
};

// 监听模型变化，持久化选择（model 通过 onRequest 按请求传入，无需重建 provider）
watch(currentModel, () => {
  schedulePersistState();
});

watch(models, () => reconcileCurrentModel());

const { onRequest, messages, setMessages, isRequesting, abort, onReload } = useXChat<
  XModelMessage,
  XModelMessage,
  XModelParams,
  XModelResponse
>({
  provider: provider,
  defaultMessages: getInitialMessages,
  requestFallback: (_, { error, errorInfo, messageInfo }) => {
    if (error.name === "AbortError") {
      return {
        content:
          typeof messageInfo?.message?.content === "string"
            ? messageInfo.message.content
            : "请求已中止",
        role: "assistant",
      };
    }
    return {
      content: errorInfo?.error?.message || "请求失败，请重试！",
      role: "assistant",
    };
  },
  requestPlaceholder: () => ({ content: "请稍候...", role: "assistant" }),
});

watch(isRequesting, (requesting) => {
  if (!requesting) {
    activeRequestConversationKey.value = "";
    pendingA2UISurfaceId.value = "";
  }
});

// 监听消息变化，同步到对话列表
watch(
  messages,
  (newMessages) => {
    const conversationWriteKey = activeRequestConversationKey.value || currentConversationKey.value;
    updateConversationMessages(conversationWriteKey, newMessages);
    schedulePersistState();
  },
  { deep: true },
);

watch(
  [conversationList, currentConversationKey],
  () => {
    schedulePersistState();
  },
  { deep: true },
);

const handleWorkspaceKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    contextOpen.value = false;
    shareOpen.value = false;
    deleteOpen.value = false;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "/") {
    event.preventDefault();
    document.querySelector<HTMLTextAreaElement>(".chat-layout textarea")?.focus();
  }
};

onMounted(async () => {
  window.addEventListener("keydown", handleWorkspaceKeydown);
  if (window.matchMedia("(max-width: 767px)").matches) {
    conversationsOpen.value = false;
  }

  const persistedState = await loadChatState();

  if (persistedState && persistedState.conversationList.length > 0) {
    applyPersistedState(persistedState);
  } else {
    conversationList.value = [];
    currentConversationKey.value = "";
    showWelcome.value = true;
  }

  isHydrating.value = false;
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWorkspaceKeydown);
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
});

// ============ 消息转换 ============

const A2UI_ACTION_PREFIX = "[A2UI_ACTION]";
const isInternalA2UIAction = (modelMessage: XModelMessage) =>
  modelMessage.role === "user" &&
  typeof modelMessage.content === "string" &&
  modelMessage.content.startsWith(A2UI_ACTION_PREFIX);

const bubbleItems = computed<BubbleItemType[]>(() =>
  currentConversationMessages.value.flatMap(({ id, message: modelMessage, status }) => {
    if (isInternalA2UIAction(modelMessage)) return [];

    return [
      {
        key: id,
        role: modelMessage.role,
        status,
        loading: status === "loading",
        content: typeof modelMessage.content === "string" ? modelMessage.content : "",
      },
    ];
  }),
);

// ============ 事件处理 ============

const handlePromptClick = (info: { data: { description?: string } }) => {
  const prompt = typeof info.data.description === "string" ? info.data.description : "";
  if (!isRequesting.value && prompt) {
    showWelcome.value = false;
    handleSubmit(prompt);
  }
};

const handleChange = (value: string) => {
  content.value = value;
};

const handleSubmit = (nextContent: string) => {
  if (!nextContent || !nextContent.trim()) return;

  // 草稿态首次发送时，才创建真实会话并写入侧栏
  if (isInDraftMode.value) {
    const newConversation = createNewConversation();
    conversationList.value.unshift(newConversation);
    currentConversationKey.value = String(newConversation.key);
  }

  setMessages(currentConversationMessages.value);
  activeRequestConversationKey.value = currentConversationKey.value;

  showWelcome.value = false;
  onRequest({
    messages: [{ role: "user", content: nextContent }],
    model: currentModel.value,
    // Qwen(DashScope/OpenAI Compatible) 深度思考参数
    enable_thinking: thinkingEnabled.value,
    // 兼容部分 OpenAI-like 网关的思考参数
    thinking: { type: thinkingEnabled.value ? "enabled" : "disabled" },
  });
  // 清空输入框
  setTimeout(() => {
    content.value = "";
  }, 0);
};

const handleA2UIAction = (payload: ActionPayload) => {
  if (isRequesting.value) {
    message.warning("回答生成中，请稍后再操作界面");
    return;
  }

  pendingA2UISurfaceId.value = payload.surfaceId;
  const serializedContext = JSON.stringify(payload.context ?? {}).slice(0, 4000);
  handleSubmit(
    `${A2UI_ACTION_PREFIX}\nsurfaceId: ${payload.surfaceId}\nname: ${payload.name}\ncontext: ${serializedContext}`,
  );
};

const handleModelChange = (key: string) => {
  currentModel.value = key;
};

const handleThinkingChange = (value: boolean) => {
  thinkingEnabled.value = value;
};

const handleReloadMessage = (messageId: string | number) => {
  setMessages(currentConversationMessages.value);
  onReload(messageId, { model: currentModel.value });
};

const handleRenameConversation = (title: string) => {
  const conversation = getCurrentConversation();
  if (!conversation) return;
  conversation.label = title;
  schedulePersistState();
};

const handlePinConversation = () => {
  const conversation = getCurrentConversation();
  if (!conversation) return;
  conversation.group = conversation.group === "置顶" ? "今天" : "置顶";
  schedulePersistState();
  message.success(conversation.group === "置顶" ? "对话已置顶" : "已取消置顶");
};

const resetAfterRemovingConversation = () => {
  setMessages([]);
  currentConversationKey.value = "";
  showWelcome.value = true;
  contextOpen.value = false;
  schedulePersistState();
};

const handleArchiveConversation = () => {
  if (!currentConversationKey.value) return;
  conversationList.value = conversationList.value.filter(
    (conversation) => String(conversation.key) !== currentConversationKey.value,
  );
  resetAfterRemovingConversation();
  message.success("对话已归档");
};

const handleDeleteConversation = () => {
  if (currentConversationKey.value) {
    conversationList.value = conversationList.value.filter(
      (conversation) => String(conversation.key) !== currentConversationKey.value,
    );
  }
  deleteOpen.value = false;
  resetAfterRemovingConversation();
  message.success("对话已删除");
};

const handleClearCurrentMessages = () => {
  const conversation = getCurrentConversation();
  if (conversation) conversation.messages = [];
  setMessages([]);
  showWelcome.value = true;
  contextOpen.value = false;
  schedulePersistState();
  message.success("当前对话已清空");
};

const copyShareLink = async () => {
  try {
    await navigator.clipboard.writeText("https://openchat.dev/share/current");
    message.success("分享链接已复制");
  } catch {
    message.warning("无法访问剪贴板，请手动复制");
  }
};
</script>

<template>
  <div class="chat-layout">
    <a class="skip-link" href="#chat-content">跳到消息内容</a>
    <button
      v-if="conversationsOpen"
      class="sidebar-backdrop"
      type="button"
      aria-label="关闭对话侧栏"
      @click="closeSidebar"
    ></button>
    <ChatSidebar
      :open="conversationsOpen"
      :dark="dark"
      :conversation-list="conversationList"
      :current-key="currentConversationKey"
      @home="emit('navigate', '/')"
      @toggle-sidebar="handleSidebarToggle"
      @toggle-theme="emit('toggleTheme')"
      @new-conversation="handleNewConversation"
      @active-change="handleActiveChange"
    />

    <div class="chat-main">
      <ChatHeader
        :title="currentConversationTitle"
        :sidebar-open="conversationsOpen"
        :context-open="contextOpen"
        :syncing="isRequesting"
        @toggle-sidebar="handleSidebarToggle"
        @toggle-context="contextOpen = !contextOpen"
        @share="shareOpen = true"
        @rename="handleRenameConversation"
        @pin="handlePinConversation"
        @archive="handleArchiveConversation"
        @delete="deleteOpen = true"
      />

      <ChatMessages
        :show-welcome="showWelcome && currentConversationMessages.length === 0"
        :bubble-items="bubbleItems"
        :conversation-key="currentConversationKey"
        :a2ui-pending-surface-id="pendingA2UISurfaceId"
        @a2ui-action="handleA2UIAction"
        @reload="handleReloadMessage"
      />

      <ChatInput
        v-model="content"
        :loading="isRequesting"
        :current-model="currentModel"
        :current-model-label="currentModelLabel"
        :model-items="modelDropdownItems ?? []"
        :thinking-enabled="thinkingEnabled"
        :show-starter-prompts="showWelcome && currentConversationMessages.length === 0"
        @change="handleChange"
        @cancel="abort"
        @submit="handleSubmit"
        @model-change="handleModelChange"
        @thinking-change="handleThinkingChange"
        @prompt-click="handlePromptClick"
      />
    </div>

    <aside
      class="context-panel"
      :class="{ open: contextOpen }"
      :aria-hidden="!contextOpen"
      aria-label="对话详情"
    >
      <header>
        <strong>对话详情</strong
        ><button type="button" aria-label="关闭对话详情" @click="contextOpen = false"><X /></button>
      </header>
      <div class="context-content">
        <section>
          <div class="context-heading">
            <h2>上下文</h2>
            <button type="button" @click="message.info('可在输入区添加附件')"><Plus />添加</button>
          </div>
          <div class="context-file">
            <span><FileText /></span
            ><span><strong>launch-plan.pdf</strong><small>12 页 · 2.4 MB</small></span>
          </div>
          <div class="context-file">
            <span><Link2 /></span><span><strong>发布检查清单</strong><small>刚刚同步</small></span>
          </div>
        </section>
        <section>
          <div class="context-heading"><h2>本次对话</h2></div>
          <dl>
            <div>
              <dt>模型</dt>
              <dd>{{ currentModelLabel }}</dd>
            </div>
            <div>
              <dt>消息</dt>
              <dd>{{ currentConversationMessages.length }}</dd>
            </div>
            <div>
              <dt>存储</dt>
              <dd>本地 IndexedDB</dd>
            </div>
          </dl>
        </section>
        <section>
          <div class="context-heading">
            <h2>记忆</h2>
            <Switch v-model:checked="memoryEnabled" />
          </div>
          <p>Open Chat 会参考当前对话中的上下文，让后续回答保持一致。</p>
        </section>
      </div>
      <footer>
        <button type="button" @click="handleExportLocalHistory"><Download />导出对话</button>
        <button class="destructive" type="button" @click="handleClearCurrentMessages">
          <Trash2 />清空消息
        </button>
      </footer>
    </aside>
    <button
      v-if="contextOpen"
      class="context-scrim"
      type="button"
      aria-label="关闭对话详情"
      @click="contextOpen = false"
    ></button>

    <Modal
      v-model:open="shareOpen"
      :footer="null"
      centered
      :width="470"
      wrap-class-name="share-dialog-wrap"
    >
      <div class="share-dialog-content">
        <header>
          <h2>分享这段对话</h2>
          <p>拥有链接的人可以查看当前内容。</p>
        </header>
        <label
          ><span>公开链接</span
          ><Input readonly value="https://openchat.dev/share/current"
            ><template #suffix
              ><Button size="small" @click="copyShareLink"><Copy />复制</Button></template
            ></Input
          ></label
        >
        <div class="permission-row">
          <span><strong>允许继续对话</strong><small>访客可以从分享内容创建副本</small></span
          ><Switch v-model:checked="allowSharedCopy" />
        </div>
        <footer>
          <Button @click="shareOpen = false">取消</Button
          ><Button
            type="primary"
            @click="
              shareOpen = false;
              message.success('分享设置已保存');
            "
            >完成</Button
          >
        </footer>
      </div>
    </Modal>

    <Modal
      v-model:open="deleteOpen"
      :footer="null"
      centered
      :width="410"
      wrap-class-name="delete-dialog-wrap"
    >
      <div class="delete-dialog-content">
        <span><Trash2 /></span>
        <h2>删除这段对话？</h2>
        <p>删除后无法恢复，对话中的消息和本地记录都会被移除。</p>
        <footer>
          <Button @click="deleteOpen = false">取消</Button
          ><Button danger type="primary" @click="handleDeleteConversation">删除对话</Button>
        </footer>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.chat-layout {
  position: relative;
  display: flex;
  min-height: 100dvh;
  height: 100vh;
  overflow: hidden;
  background: var(--brand-background);
  color: var(--brand-foreground);
}

.chat-layout::selection {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}

.sidebar-backdrop {
  display: none;
}

.chat-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background: var(--brand-workspace);
}

.context-panel {
  position: relative;
  z-index: 24;
  display: flex;
  width: 0;
  min-width: 0;
  height: 100dvh;
  flex-direction: column;
  overflow: hidden;
  border-left: 0 solid var(--brand-border);
  background: var(--brand-sidebar);
  opacity: 0;
  pointer-events: none;
  transform: translateX(18px);
  transition:
    width 220ms ease,
    min-width 220ms ease,
    opacity 180ms ease,
    transform 220ms ease;
}
.context-panel.open {
  width: 312px;
  min-width: 312px;
  border-left-width: 1px;
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}
.context-panel > header {
  display: flex;
  height: 58px;
  flex: 0 0 58px;
  align-items: center;
  justify-content: space-between;
  padding: 0 11px 0 16px;
  border-bottom: 1px solid var(--brand-border);
}
.context-panel > header strong {
  font-size: 12px;
}
.context-panel button {
  cursor: pointer;
}
.context-panel > header button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--brand-muted);
}
.context-panel > header button:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.context-panel > header button :deep(svg) {
  width: var(--icon-md);
  height: var(--icon-md);
}
.context-content {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 5px 16px 24px;
}
.context-content > section {
  padding: 21px 0;
  border-bottom: 1px solid var(--brand-border);
}
.context-content > section:last-child {
  border-bottom: 0;
}
.context-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.context-heading h2 {
  margin: 0;
  font-size: 11px;
}
.context-heading > button {
  display: flex;
  min-height: 28px;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--brand-muted);
  font-size: 9px;
}
.context-heading > button:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.context-heading > button :deep(svg) {
  width: 12px;
  height: 12px;
}
.context-file {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-height: 54px;
  margin-bottom: 5px;
  padding: 5px;
  border-radius: 5px;
}
.context-file:hover {
  background: var(--brand-surface-subtle);
}
.context-file > span:first-child {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 5px;
  background: var(--brand-surface-subtle);
}
.context-file > span:first-child :deep(svg) {
  width: 15px;
  height: 15px;
}
.context-file > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.context-file strong {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-file small {
  color: var(--brand-muted);
  font-size: 9px;
}
.context-content dl {
  margin: 0;
}
.context-content dl div {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.context-content dt {
  color: var(--brand-muted);
  font-size: 10px;
}
.context-content dd {
  margin: 0;
  font-size: 10px;
  text-align: right;
}
.context-content section > p {
  margin: 0;
  color: var(--brand-muted);
  font-size: 10px;
  line-height: 1.7;
}
.context-panel > footer {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border-top: 1px solid var(--brand-border);
}
.context-panel > footer button {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--brand-muted);
  font-size: 10px;
  text-align: left;
}
.context-panel > footer button:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.context-panel > footer button.destructive:hover {
  background: var(--brand-danger-subtle);
  color: var(--brand-danger);
}
.context-panel > footer button :deep(svg) {
  width: 14px;
  height: 14px;
}
.context-scrim {
  display: none;
}
.share-dialog-content > header h2 {
  margin: 0;
  font-size: 16px;
}
.share-dialog-content > header p {
  margin: 5px 0 0;
  color: var(--brand-muted);
  font-size: 11px;
}
.share-dialog-content > label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 22px;
  font-size: 10px;
  font-weight: 600;
}
.share-dialog-content > label :deep(.ant-input-affix-wrapper) {
  min-height: 42px;
  margin-top: 7px;
}
.share-dialog-content > label :deep(.ant-btn) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.share-dialog-content > label :deep(svg) {
  width: 12px;
  height: 12px;
}
.permission-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: center;
  gap: 14px;
  min-height: 62px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--brand-border);
}
.permission-row > span {
  display: flex;
  flex-direction: column;
}
.context-panel :deep(.ant-switch),
.permission-row :deep(.ant-switch) {
  position: relative;
  min-width: 44px;
}
.context-panel :deep(.ant-switch)::after,
.permission-row :deep(.ant-switch)::after {
  position: absolute;
  inset: -11px 0;
  content: "";
}
.permission-row strong {
  font-size: 10px;
}
.permission-row small {
  color: var(--brand-muted);
  font-size: 9px;
}
.share-dialog-content > footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}
:global(.share-dialog-wrap .ant-modal-content) {
  padding: 20px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
}
:global(.share-dialog-wrap .ant-modal-close) {
  top: 13px;
  right: 13px;
}
.delete-dialog-content > span {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  margin-bottom: 14px;
  border-radius: 6px;
  background: var(--brand-danger-subtle);
  color: var(--brand-danger);
}
.delete-dialog-content > span :deep(svg) {
  width: 17px;
  height: 17px;
}
.delete-dialog-content h2 {
  margin: 0;
  font-size: 16px;
}
.delete-dialog-content p {
  margin: 5px 0 0;
  color: var(--brand-muted);
  font-size: 11px;
  line-height: 1.6;
}
.delete-dialog-content footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}
:global(.delete-dialog-wrap .ant-modal-content) {
  padding: 20px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
}

@media (max-width: 1180px) {
  .context-panel,
  .context-panel.open {
    position: fixed;
    top: 0;
    right: 0;
    width: min(312px, calc(100% - 24px));
    min-width: 0;
    box-shadow: -18px 0 46px rgba(9, 9, 11, 0.14);
    transform: translateX(102%);
  }
  .context-panel.open {
    transform: translateX(0);
  }
  .context-scrim {
    position: fixed;
    z-index: 23;
    inset: 0;
    display: block;
    padding: 0;
    border: 0;
    background: rgba(9, 9, 11, 0.24);
  }
}

@media (max-width: 767px) {
  .sidebar-backdrop {
    position: absolute;
    z-index: var(--z-backdrop);
    inset: 0;
    display: block;
    border: 0;
    background: rgba(9, 9, 11, 0.4);
  }

  .chat-main {
    width: 100%;
  }
  .context-panel > header {
    height: 56px;
    flex-basis: 56px;
  }
  .context-panel > header button {
    width: 44px;
    height: 44px;
  }
  .context-heading > button,
  .context-panel > footer button {
    min-height: 44px;
  }
}

@media (max-width: 560px) {
  :global(.share-dialog-wrap .ant-modal) {
    max-width: 100%;
    margin: 0;
    padding-bottom: 0;
    top: auto;
  }
  :global(.share-dialog-wrap .ant-modal-wrap) {
    display: flex;
    align-items: flex-end;
  }
  :global(.share-dialog-wrap .ant-modal-content),
  :global(.delete-dialog-wrap .ant-modal-content) {
    border-width: 1px 0 0;
    border-radius: 8px 8px 0 0;
  }
  :global(.delete-dialog-wrap .ant-modal) {
    max-width: 100%;
    margin: 0;
    padding-bottom: 0;
    top: auto;
  }
}
</style>

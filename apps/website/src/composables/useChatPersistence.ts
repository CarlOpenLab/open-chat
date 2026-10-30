import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import {
  CONVERSATION_LIMITS,
  type ConversationRecord,
  type MessageAttachmentRef,
  type QueuedMessage,
} from "@cc-heart/open-chat-types";
import { message } from "antdv-next";
import { computed, onBeforeUnmount, watch, type Ref } from "vue";
import { ApiError, gatewayFetch, readErrorMessage } from "../services/http";
import { conversationsApi } from "../services/workspaceApi";

/** 置顶会话的分组标记（侧栏按日期分组，置顶单独成组）。 */
export const PINNED_GROUP = "置顶";
const DEFAULT_TITLE = "新对话";

/**
 * 前端内存中的会话：索引字段与网关 ConversationRecord 一一对应；
 * messages 只在内存中——ACP 会话由 agent 历史提供，Model API 会话从 transcript 恢复。
 */
export interface OpenChatConversation {
  key: string;
  label: string;
  /** 「置顶」表示置顶，其余由侧栏按 updatedAt 计算日期分组。 */
  group?: string;
  createdAt?: number;
  updatedAt?: number;
  /** 会话所属供应商；缺省归入 Model API。 */
  agentId?: string;
  /** 会话使用的模型。 */
  modelId?: string;
  /** 供应商真实会话 id（ACP session/load 跨进程恢复）。 */
  providerSessionId?: string;
  projectPath?: string;
  systemPrompt?: string;
  /** 所属任务（任务抽屉「新建会话」时写入）。 */
  taskId?: string;
  /** 看板手动归列的覆盖状态；缺省时按运行信号自动推导。 */
  statusOverride?: string;
  /** 出错或手动停止的持久标记，用于看板已终止归类。 */
  lastError?: string;
  queuedMessages?: QueuedMessage[];
  queuePaused?: boolean;
  messages?: DefaultMessageInfo<XModelMessage>[];
}

/**
 * @description 生成会话标题摘要：去掉 think 块、压缩空白并截断。
 * @param {string} content - 消息正文
 * @param {number} maxLength - 最大长度
 * @returns {string} 标题
 */
export const getMessagePreview = (content: string, maxLength: number = 20): string => {
  const withoutThink = content
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, "")
    .replace(/<\/?think(?:\s+[^>]*)?\s*>/gi, "");
  const normalized = withoutThink.replace(/\s+/g, " ").trim();
  if (!normalized && /<think\b/i.test(content)) return "思考中...";
  if (!normalized) return DEFAULT_TITLE;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

/**
 * @description 可选文本字段：去首尾空白，空串视为 null（与网关规范化规则一致）。
 * @param {unknown} value - 原始值
 * @param {number} limit - 最大长度
 * @returns {string | null} 规范化结果
 */
function optionalText(value: unknown, limit = 500): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, limit) || null;
}

/**
 * @description 规范化排队消息（与网关规则一致，保证往返后 JSON 不变）。
 * @param {QueuedMessage[] | undefined} queue - 排队消息
 * @returns {QueuedMessage[]} 可持久化的排队消息
 */
function normalizeQueue(queue: QueuedMessage[] | undefined): QueuedMessage[] {
  if (!Array.isArray(queue)) return [];
  return queue.flatMap((item) => {
    const attachments: MessageAttachmentRef[] = (item.attachments ?? []).flatMap((attachment) => {
      const reference = optionalText(attachment.reference, 300);
      const name = optionalText(attachment.name, 300);
      return reference && name ? [{ reference, name, isImage: attachment.isImage === true }] : [];
    });
    const content = (item.content ?? "").trim().slice(0, CONVERSATION_LIMITS.queuedContent);
    if (!content && attachments.length === 0) return [];
    return [
      {
        id: item.id,
        content,
        createdAt: item.createdAt,
        ...(attachments.length ? { attachments } : {}),
      },
    ];
  });
}

/**
 * @description 会话 → 网关记录（只含索引字段，不含消息）。
 * @param {OpenChatConversation} conversation - 内存会话
 * @returns {ConversationRecord} 网关记录
 */
export function conversationToRecord(conversation: OpenChatConversation): ConversationRecord {
  // 缺失时间戳时取确定值（网关会以写入时间补齐），保证同一会话多次序列化结果一致
  const updatedAt = conversation.updatedAt ?? conversation.createdAt ?? 0;
  return {
    key: String(conversation.key),
    title:
      (typeof conversation.label === "string"
        ? conversation.label.trim().slice(0, CONVERSATION_LIMITS.title)
        : "") || DEFAULT_TITLE,
    pinned: conversation.group === PINNED_GROUP,
    agentId: optionalText(conversation.agentId, 100) ?? "api",
    modelId: optionalText(conversation.modelId) ?? "",
    providerSessionId: optionalText(conversation.providerSessionId),
    projectPath: optionalText(conversation.projectPath),
    systemPrompt: (conversation.systemPrompt ?? "").slice(0, CONVERSATION_LIMITS.systemPrompt),
    taskId: optionalText(conversation.taskId, 64),
    statusOverride: optionalText(conversation.statusOverride, 32),
    lastError: optionalText(conversation.lastError, 2000),
    queuePaused: conversation.queuePaused === true,
    queuedMessages: normalizeQueue(conversation.queuedMessages),
    createdAt: conversation.createdAt ?? updatedAt,
    updatedAt,
  };
}

/**
 * @description 网关记录 → 内存会话。
 * @param {ConversationRecord} record - 网关记录
 * @returns {OpenChatConversation} 内存会话（messages 为空，按需加载）
 */
export function recordToConversation(record: ConversationRecord): OpenChatConversation {
  return {
    key: record.key,
    label: record.title,
    group: record.pinned ? PINNED_GROUP : "今天",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    agentId: record.agentId,
    modelId: record.modelId,
    ...(record.providerSessionId ? { providerSessionId: record.providerSessionId } : {}),
    ...(record.projectPath ? { projectPath: record.projectPath } : {}),
    systemPrompt: record.systemPrompt,
    ...(record.taskId ? { taskId: record.taskId } : {}),
    ...(record.statusOverride ? { statusOverride: record.statusOverride } : {}),
    ...(record.lastError ? { lastError: record.lastError } : {}),
    queuedMessages: record.queuedMessages,
    queuePaused: record.queuePaused,
  };
}

/** 已排队的删除操作标记（避免重复入队）。 */
const REMOVAL = "\u0000removal";
/** 写入失败后的重试间隔。 */
const RETRY_DELAY_MS = 2000;
/** 同类错误提示的最短间隔，避免离线时刷屏。 */
const ERROR_NOTICE_INTERVAL_MS = 10_000;

interface UseChatPersistenceOptions {
  conversationList: Ref<OpenChatConversation[]>;
  /** 启动水合期间不写入（列表尚未从网关加载完成）。 */
  isHydrating: Ref<boolean>;
  isRequesting: Ref<boolean>;
  /** 清空历史后重置为草稿态。 */
  onCleared: () => void;
}

/**
 * 会话持久化：把内存会话列表同步到网关 SQLite。
 *
 * - 只追踪索引字段（computed 不读取 messages），流式输出不会触发任何写入；
 * - 按会话做脏检查，只 PUT 变化了的会话；从列表消失的会话发 DELETE / 归档；
 * - 同一会话的写请求串行执行，保证网关按发生顺序落盘；失败自动重试。
 */
export function useChatPersistence(options: UseChatPersistenceOptions) {
  const { conversationList, isHydrating, isRequesting, onCleared } = options;

  /** 网关已确认保存的记录 JSON（key → JSON）。 */
  const synced = new Map<string, string>();
  /** 已入队、尚未确认的最新记录 JSON 或删除标记。 */
  const queued = new Map<string, string>();
  /** 每个会话的写请求链。 */
  const chains = new Map<string, Promise<void>>();
  /** 以归档（而非删除）方式移出列表的会话。 */
  const archivedKeys = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastErrorNoticeAt = 0;

  /** 当前列表的索引快照：只依赖索引字段，消息流式更新不会让它失效。 */
  const snapshot = computed(
    () =>
      new Map(
        conversationList.value.map((conversation) => [
          String(conversation.key),
          JSON.stringify(conversationToRecord(conversation)),
        ]),
      ),
  );

  /**
   * @description 把写操作追加到会话的请求链（前一个失败不影响后一个执行）。
   * @param {string} key - 会话 key
   * @param {() => Promise<void>} task - 写操作
   * @returns {Promise<void>} 本次写操作的结果
   */
  const enqueue = (key: string, task: () => Promise<void>): Promise<void> => {
    const next = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
    chains.set(key, next);
    void next
      .catch(() => undefined)
      .then(() => {
        if (chains.get(key) === next) chains.delete(key);
      });
    return next;
  };

  /**
   * @description 处理写入失败：清除入队标记以便重试，提示用户（节流），可重试的错误稍后自动重试。
   * @param {string} key - 会话 key
   * @param {unknown} error - 失败原因
   * @returns {void}
   */
  const handleSyncError = (key: string, error: unknown) => {
    const retryable = !(error instanceof ApiError) || error.status === 409 || error.status >= 500;
    if (retryable) {
      queued.delete(key);
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          flushPersistState();
        }, RETRY_DELAY_MS);
      }
      // 409：所属任务还在创建中，属于正常竞态，静默重试
      if (error instanceof ApiError && error.status === 409) return;
    }
    console.error(`Failed to sync conversation ${key}:`, error);
    if (Date.now() - lastErrorNoticeAt > ERROR_NOTICE_INTERVAL_MS) {
      lastErrorNoticeAt = Date.now();
      message.error(error instanceof Error ? `会话保存失败：${error.message}` : "会话保存失败");
    }
  };

  /**
   * @description 立即把差异写入网关：变化的会话 PUT，消失的会话 DELETE / 归档。
   * @returns {void}
   */
  const flushPersistState = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (isHydrating.value) return;
    const current = snapshot.value;
    for (const [key, json] of current) {
      if (synced.get(key) === json || queued.get(key) === json) continue;
      queued.set(key, json);
      const record = JSON.parse(json) as ConversationRecord;
      enqueue(key, async () => {
        await conversationsApi.save(record);
        synced.set(key, json);
        if (queued.get(key) === json) queued.delete(key);
      }).catch((error: unknown) => handleSyncError(key, error));
    }
    for (const key of new Set([...synced.keys(), ...queued.keys()])) {
      if (current.has(key) || queued.get(key) === REMOVAL) continue;
      queued.set(key, REMOVAL);
      const archive = archivedKeys.has(key);
      enqueue(key, async () => {
        if (archive) await conversationsApi.archive(key);
        else await conversationsApi.remove(key);
        synced.delete(key);
        archivedKeys.delete(key);
        if (queued.get(key) === REMOVAL) queued.delete(key);
      }).catch((error: unknown) => handleSyncError(key, error));
    }
  };

  /**
   * @description 防抖写入（连续修改合并为一次同步）。
   * @returns {void}
   */
  const schedulePersistState = () => {
    if (isHydrating.value) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushPersistState, 250);
  };

  /**
   * @description 用网关加载的记录初始化会话列表，并把它们登记为「已同步」。
   * @param {ConversationRecord[]} records - 网关会话记录
   * @returns {OpenChatConversation[]} 内存会话列表
   */
  const hydrate = (records: ConversationRecord[]): OpenChatConversation[] => {
    synced.clear();
    queued.clear();
    const conversations = records.map(recordToConversation);
    for (const conversation of conversations) {
      synced.set(conversation.key, JSON.stringify(conversationToRecord(conversation)));
    }
    return conversations;
  };

  /**
   * @description 标记会话以「归档」方式移出列表（下一次同步发归档请求而非删除）。
   * @param {string} key - 会话 key
   * @returns {void}
   */
  const markArchived = (key: string) => {
    archivedKeys.add(key);
  };

  /**
   * @description 保存 Model API 会话的消息（排在该会话的索引写入之后，保证会话已存在）。
   * @param {string} key - 会话 key
   * @returns {void}
   */
  const saveTranscript = (key: string) => {
    const conversation = conversationList.value.find((item) => String(item.key) === key);
    if (!conversation?.messages) return;
    const settled = conversation.messages.filter(
      (item) => item.status !== "loading" && item.status !== "updating",
    );
    const messages = JSON.parse(JSON.stringify(settled)) as unknown[];
    flushPersistState();
    enqueue(key, () => conversationsApi.saveTranscript(key, messages)).catch((error: unknown) =>
      handleSyncError(key, error),
    );
  };

  /**
   * @description 读取 Model API 会话保存的消息。
   * @param {string} key - 会话 key
   * @returns {Promise<DefaultMessageInfo<XModelMessage>[]>} 消息；从未保存过时为空数组
   */
  const loadTranscript = async (key: string): Promise<DefaultMessageInfo<XModelMessage>[]> => {
    const messages = await conversationsApi.getTranscript(key);
    return (messages ?? []) as DefaultMessageInfo<XModelMessage>[];
  };

  /**
   * @description 清空全部会话（任务保留，关联自动解除）。
   * @returns {Promise<void>}
   */
  const handleClearLocalHistory = async () => {
    if (isRequesting.value) {
      message.warning("回答生成中，请先手动停止后再清空历史");
      return;
    }
    if (!window.confirm("确定清空全部会话吗？此操作不可恢复。")) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    try {
      await Promise.allSettled(chains.values());
      await conversationsApi.clear();
      synced.clear();
      queued.clear();
      conversationList.value = [];
      onCleared();
      message.success("会话已清空");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "清空会话失败");
    }
  };

  /**
   * @description 下载工作区完整备份（任务、会话、Model API 消息、偏好；服务商 Key 只含掩码）。
   * @returns {Promise<void>}
   */
  const handleExportLocalHistory = async () => {
    try {
      flushPersistState();
      await Promise.allSettled(chains.values());
      const response = await gatewayFetch("/api/workspace/export");
      if (!response.ok) throw new Error(await readErrorMessage(response, "备份导出失败"));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `open-chat-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      link.click();
      URL.revokeObjectURL(url);
      message.success("备份已导出");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "备份导出失败");
    }
  };

  watch(snapshot, () => schedulePersistState());
  // 水合期间的修改（如目录归一化）在水合结束后补写
  watch(isHydrating, (hydrating) => {
    if (!hydrating) schedulePersistState();
  });

  onBeforeUnmount(() => {
    // 卸载前把尚未写出的修改立即发出
    flushPersistState();
    if (retryTimer) clearTimeout(retryTimer);
  });

  return {
    hydrate,
    markArchived,
    schedulePersistState,
    flushPersistState,
    saveTranscript,
    loadTranscript,
    handleClearLocalHistory,
    handleExportLocalHistory,
  };
}

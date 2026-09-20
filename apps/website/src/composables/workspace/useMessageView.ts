import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import { computed, reactive, type Ref } from "vue";
import { modelMessagesToBubbleItems } from "../../services/transcript";

export interface OptimisticChatMessage {
  conversationKey: string;
  id: string;
  message: XModelMessage;
  extraInfo: Record<string, unknown>;
}

export interface UseMessageViewDeps {
  currentConversationKey: Ref<string>;
  currentConversationMessages: Ref<DefaultMessageInfo<XModelMessage>[]>;
  currentConversationBusyState: Ref<{ startedAt: number } | undefined>;
  isConversationRunning: (key: string) => boolean;
}

/**
 * 消息渲染视图：乐观消息占位（本地回显的用户气泡）与聊天区气泡列表。
 * 乐观消息的写入/清除由运行域负责，这里只持有数据与读取口径。
 */
export function useMessageView(deps: UseMessageViewDeps) {
  const optimisticMessages = reactive(new Map<string, OptimisticChatMessage>());
  const optimisticMessage = computed({
    get: () =>
      deps.currentConversationKey.value
        ? (optimisticMessages.get(deps.currentConversationKey.value) ?? null)
        : null,
    set: (val: OptimisticChatMessage | null) => {
      if (!val) {
        if (deps.currentConversationKey.value)
          optimisticMessages.delete(deps.currentConversationKey.value);
      } else {
        optimisticMessages.set(val.conversationKey, val);
      }
    },
  });

  /**
   * The SDK normally preserves `optimisticId` on its local user row. Keep a
   * content fallback for the brief period where an SDK/store update omits that
   * metadata, otherwise both rows remain rendered for the whole request.
   */
  const hasAcknowledgedOptimisticMessage = (
    source: DefaultMessageInfo<XModelMessage>[],
    pending: OptimisticChatMessage,
  ): boolean => {
    if (
      source.some(
        (item) =>
          (item.extraInfo as { optimisticId?: unknown } | undefined)?.optimisticId === pending.id,
      )
    ) {
      return true;
    }

    const lastUserMessage = [...source].reverse().find((item) => item.message.role === "user");
    return (
      typeof lastUserMessage?.message.content === "string" &&
      typeof pending.message.content === "string" &&
      lastUserMessage.message.content === pending.message.content
    );
  };

  const bubbleItems = computed(() => {
    const conversationMessages = deps.currentConversationMessages.value;
    const pending = optimisticMessage.value;
    const baseItems = modelMessagesToBubbleItems(conversationMessages);

    /** 刷新后服务端仍在运行，但本地消息快照可能暂时没有 assistant 气泡。 */
    const withRunningPlaceholder = (items: ReturnType<typeof modelMessagesToBubbleItems>) => {
      if (!deps.currentConversationBusyState.value) return items;
      if (
        items.some(
          (item) =>
            item.role === "assistant" && (item.status === "loading" || item.status === "updating"),
        )
      ) {
        return items;
      }
      return [
        ...items,
        {
          key: `${deps.currentConversationKey.value}:running`,
          role: "assistant" as const,
          status: "updating" as const,
          loading: false,
          content: "",
          extraInfo: {},
        },
      ];
    };

    if (!pending || pending.conversationKey !== deps.currentConversationKey.value) {
      return withRunningPlaceholder(baseItems);
    }

    // Once useXChat has emitted the local user item, only retire that optimistic
    // row. The assistant fallback must stay until the SDK publishes its own
    // loading/updating item, otherwise the request has a visible feedback gap.
    const storeHasPendingMessage = hasAcknowledgedOptimisticMessage(conversationMessages, pending);

    const pendingInfo: DefaultMessageInfo<XModelMessage> = {
      id: pending.id,
      status: "local",
      message: pending.message,
      extraInfo: pending.extraInfo,
    };
    const hasStreamingAssistant = conversationMessages.some(
      (item) =>
        item.message.role === "assistant" &&
        (item.status === "loading" || item.status === "updating"),
    );
    const optimisticItems = storeHasPendingMessage
      ? [...conversationMessages]
      : [...conversationMessages, pendingInfo];
    // Keep the transition visually continuous even while the request store is
    // waiting to publish its placeholder row.
    if (deps.isConversationRunning(deps.currentConversationKey.value) && !hasStreamingAssistant) {
      optimisticItems.push({
        id: `${pending.id}:thinking`,
        // Render through AssistantMessageContent so the waiting phase uses the
        // same "工作中" indicator as the subsequent streamed response.
        status: "updating",
        message: { role: "assistant", content: "" },
      });
    }
    return withRunningPlaceholder(modelMessagesToBubbleItems(optimisticItems));
  });

  return {
    optimisticMessages,
    optimisticMessage,
    hasAcknowledgedOptimisticMessage,
    bubbleItems,
  };
}

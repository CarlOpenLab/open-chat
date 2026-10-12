import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";

export type ModelMessages = DefaultMessageInfo<XModelMessage>[];

/**
 * 取当前会话中「仍在累积」的 assistant 气泡（流式渲染的基底）。
 * 没有进行中的回合时返回空数组——此时刷新应当整表采用服务端历史。
 */
export function collectStreamingAssistantMessages(
  messages: ModelMessages,
  isRunning: (key: string) => boolean,
  conversationKey: string,
): ModelMessages {
  if (!conversationKey || !isRunning(conversationKey)) return [];
  return messages.filter(
    (item) =>
      item.message.role === "assistant" &&
      (item.status === "loading" || item.status === "updating"),
  );
}

/** refreshAcpSession 里历史替换的四种非流式情形，返回是否采用服务端历史整表替换。 */
export function shouldReplaceHistoryWithServer(input: {
  localMessages: ModelMessages;
  serverMessages: ModelMessages;
  hasLocalError: boolean;
  hasServerError: boolean;
}): boolean {
  const { localMessages, serverMessages, hasLocalError, hasServerError } = input;
  // a. 本地无错误：服务端为准。
  if (!hasLocalError) return true;
  // b. 本地有错误且服务端也有：错误已同步到服务端，可按服务端展示。
  if (hasServerError) return true;
  // c. 本地有错误、服务端干净、本地为空：没有可保留的本地状态。
  if (!localMessages.length) return true;
  // d. 本地有错误、服务端干净、本地有内容：保留本地，错误提示留给用户看。
  return !serverMessages.length ? true : false;
}

/**
 * 把进行中的流式气泡拼到服务端历史之后。
 *
 * 流式气泡的 id 是 `msg-<ts>-<rand>`，服务端历史另有 id，因此通常是追加；
 * 但 reload（同 id 重发）时按 id 覆盖，避免同一位置出现两条气泡。
 */
export function mergeStreamingWithHistory(
  streaming: ModelMessages,
  history: ModelMessages,
): ModelMessages {
  const streamingById = new Map(streaming.map((item) => [String(item.id), item]));
  const merged = history.map((item) => {
    const override = streamingById.get(String(item.id));
    return override ? { ...item, message: override.message, status: override.status } : item;
  });
  const appended = streaming.filter(
    (item) => !merged.some((entry) => String(entry.id) === String(item.id)),
  );
  return [...merged, ...appended];
}

/**
 * 实时流的 snapshot 帧（native 流：每次重订阅都会收到）合并进当前消息列表。
 *
 * native 服务端只在**回合开始时**抓一次快照（agentManager.ts 的
 * `[...history, 用户消息]`），之后不更新，所以它必然不含当前回合已产出的
 * assistant 输出。整表替换会把正在累积的流式气泡抹掉——正文倒退、「工作中」
 * 指示失去挂载点。因此快照只作为历史基底，本地仍在累积的气泡必须拼回去。
 *
 * 无进行中回合时（本地没有 loading/updating 气泡）没有可保留的状态，直接采用快照。
 */
export function mergeStreamSnapshotWithLocal(
  snapshot: ModelMessages,
  localMessages: ModelMessages,
  isRunning: (key: string) => boolean,
  conversationKey: string,
): ModelMessages {
  const streaming = collectStreamingAssistantMessages(localMessages, isRunning, conversationKey);
  if (!streaming.length) return snapshot;
  return mergeStreamingWithHistory(streaming, snapshot);
}

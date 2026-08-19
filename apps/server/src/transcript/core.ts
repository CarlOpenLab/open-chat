import type {
  ContentMessage,
  FileChangeMessage,
  PlanMessage,
  ReasoningMessage,
  ToolMessage,
  TranscriptHistoryCollector,
  TranscriptMessage,
  TranscriptRole,
  WorkspaceMessage,
} from "./types";

// ─────────────────────────────────────────────────────────────
// 扁平消息 collector（服务端 live 累积，如 ACP）。
// ─────────────────────────────────────────────────────────────

export function createTranscriptCollector(
  messages: TranscriptMessage[] = [],
): TranscriptHistoryCollector {
  return { messages, nextId: messages.length, activeRole: messages.at(-1)?.role ?? null };
}

export function transcriptMessageFor(
  collector: TranscriptHistoryCollector,
  role: TranscriptRole,
  idPrefix = "transcript",
): TranscriptMessage {
  const last = collector.messages.at(-1);
  if (last && collector.activeRole === role) return last;

  const timestamp = Date.now();
  const id = `${idPrefix}-${collector.nextId++}`;
  const message = createMessage(role, id, timestamp);
  collector.messages.push(message);
  collector.activeRole = role;
  return message;
}

function createMessage(role: TranscriptRole, id: string, timestamp: number): TranscriptMessage {
  switch (role) {
    case "user":
      return { id, timestamp, role: "user", content: "" };
    case "reasoning":
      return { id, timestamp, role: "reasoning", content: "" };
    case "content":
      return { id, timestamp, role: "content", content: "" };
    case "tool":
      return { id, timestamp, role: "tool", name: "", status: "pending" };
    case "plan":
      return { id, timestamp, role: "plan", entries: [] };
    case "fileChange":
      return { id, timestamp, role: "fileChange", path: "" };
    case "workspace":
      return { id, timestamp, role: "workspace", files: [], errors: [] };
  }
}

// ─────────────────────────────────────────────────────────────
// 扁平消息操作。
// ─────────────────────────────────────────────────────────────

/** 相邻 content 消息合并（块之间用空行），否则追加。 */
export function appendContentMessage(
  messages: TranscriptMessage[],
  id: string,
  timestamp: number,
  text: string,
): void {
  if (!text) return;
  const previous = messages.at(-1);
  if (previous?.role === "content") {
    messages[messages.length - 1] = {
      ...previous,
      content: `${previous.content}\n\n${text}`,
    };
  } else {
    messages.push({ id, timestamp, role: "content", content: text });
  }
}

/** 相邻 reasoning 消息合并，否则追加。 */
export function appendReasoningMessage(
  messages: TranscriptMessage[],
  id: string,
  timestamp: number,
  text: string,
): void {
  if (!text) return;
  const previous = messages.at(-1);
  if (previous?.role === "reasoning") {
    messages[messages.length - 1] = {
      ...previous,
      content: `${previous.content}${text}`,
    };
  } else {
    messages.push({ id, timestamp, role: "reasoning", content: text });
  }
}

/** 工具消息按 id upsert（后到状态覆盖旧状态）。 */
export function upsertToolMessage(messages: TranscriptMessage[], tool: ToolMessage): void {
  const index = messages.findIndex((message) => message.role === "tool" && message.id === tool.id);
  if (index === -1) messages.push(tool);
  else messages[index] = { ...(messages[index] as ToolMessage), ...tool };
}

/** plan 消息唯一，后到者覆盖。 */
export function upsertPlanMessage(
  messages: TranscriptMessage[],
  id: string,
  timestamp: number,
  entries: PlanMessage["entries"],
): void {
  const index = messages.findIndex((message) => message.role === "plan");
  const message: PlanMessage = { id, timestamp, role: "plan", entries };
  if (index === -1) messages.push(message);
  else messages[index] = message;
}

/** 文件修改消息按 path upsert。 */
export function upsertFileChangeMessage(
  messages: TranscriptMessage[],
  change: FileChangeMessage,
): void {
  const index = messages.findIndex(
    (message) => message.role === "fileChange" && message.path === change.path,
  );
  if (index === -1) messages.push(change);
  else messages[index] = { ...(messages[index] as FileChangeMessage), ...change };
}

/** workspace 消息唯一，后到者覆盖。 */
export function upsertWorkspaceMessage(
  messages: TranscriptMessage[],
  workspace: WorkspaceMessage,
): void {
  const index = messages.findIndex((message) => message.role === "workspace");
  if (index === -1) messages.push(workspace);
  else messages[index] = workspace;
}

/**
 * 扁平历史规范化：合并相邻同种 content/reasoning 消息，去掉空 assistant 侧消息。
 * user 消息边界保持权威。
 */
export function normalizeTranscriptHistory(messages: TranscriptMessage[]): TranscriptMessage[] {
  const history: TranscriptMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      history.push(message);
      continue;
    }
    if (isEmptyAssistantMessage(message)) continue;
    const previous = history.at(-1);
    if (
      previous?.role === message.role &&
      (message.role === "content" || message.role === "reasoning")
    ) {
      const prev = previous as ContentMessage | ReasoningMessage;
      const current = message as ContentMessage | ReasoningMessage;
      const merged =
        message.role === "content"
          ? `${prev.content}\n\n${current.content}`
          : `${prev.content}${current.content}`;
      history[history.length - 1] = { ...prev, content: merged };
    } else {
      history.push(message);
    }
  }
  return history;
}

function isEmptyAssistantMessage(message: TranscriptMessage): boolean {
  switch (message.role) {
    case "content":
    case "reasoning":
      return !message.content.trim();
    case "plan":
      return message.entries.length === 0;
    case "workspace":
      return message.files.length === 0 && message.errors.length === 0;
    default:
      return false;
  }
}

/** 判断扁平消息列表是否有 assistant 侧内容（非 user 消息）。 */
export function hasAssistantContent(messages: readonly TranscriptMessage[]): boolean {
  return messages.some((message) => message.role !== "user");
}

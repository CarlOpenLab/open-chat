import type {
  TransformMessage,
  XModelMessage,
  XModelParams,
  XModelResponse,
  XRequestConfigOptions,
} from "@antdv-next/x-sdk";
import { DeepSeekChatProvider } from "@antdv-next/x-sdk";
import type { WebSearchSourceItem } from "./ai";

/** Transient placeholder shown in the assistant bubble while the gateway runs
 * a web search round. Replaced by real text/reasoning as soon as it arrives. */
export const WEB_SEARCHING_MARKER = "🔍 正在联网搜索…";

/** 本地 opencode 工具调用（由网关 `tool_call` SSE 事件驱动，供 ThoughtChain 渲染）。 */
export interface ToolCallItem {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "error";
  input?: unknown;
  output?: string;
  error?: string;
  durationMs?: number;
}

/** opencode 权限询问（由网关 `chat_permission` SSE 事件驱动，供前端弹窗批准）。 */
export interface PermissionRequest {
  id: string;
  /** v1 走 `/session/{id}/permissions/{permissionID}`，v2 走 `/permission/{requestID}/reply`。 */
  version: "v1" | "v2" | "acp";
  agentId?: string;
  /** v1 权限名（如 bash / edit / webfetch），v2 动作名（如 bash）。 */
  permission: string;
  /** v1 匹配模式（如命令、路径），v2 资源列表。 */
  patterns: string[];
  metadata: Record<string, unknown>;
  options?: Array<{
    optionId: string;
    name: string;
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
  }>;
  tool?: { messageID?: string; callID?: string };
}

interface ProviderSessionNotice {
  agentId?: string;
  sessionId: string;
}

/** ACP 会话运行状态（running / idle / requires_action）。当前由服务端 activeRuns 推导，经 /api/acp/session 返回给前端。 */
export interface AcpRunStateNotice {
  state: string;
  stopReason?: string;
}

/** OpenAI function-tool definition for web search. Declared in the request
 * `tools` array so the model autonomously decides whether to call it; the
 * gateway intercepts the call and runs the configured search provider. */
const WEB_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the web for up-to-date information. Call this when the user's question " +
      "needs real-time data, recent events, or facts beyond your training data. " +
      "Do not call it for general knowledge you already have.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
};

export interface OpenChatParams extends XModelParams {
  /** Composer execution preferences (consumed by compatible local agents). */
  mode?: "build" | "plan";
  permission?: "supervised" | "auto" | "full";
  systemPrompt?: string;
  /** When true, declares a `web_search` tool in the request so the model can
   * autonomously decide whether to search. The gateway executes the call. */
  web_search?: boolean;
  /** 前端会话 id：本地 opencode（服务端）用它复用长会话。 */
  conversationId?: string;
  /** 本地 CLI Agent id。存在时服务端按该 Agent 的原生协议或 ACP 运行。 */
  acpAgentId?: string;
  /** 供应商返回的真实会话 id，用于 ACP session/load 跨进程恢复。 */
  providerSessionId?: string;
  /** Optional project working directory for local agents. Empty means server default. */
  projectPath?: string;
  /** 无状态代理的转发目标：随每次请求携带（baseUrl / apiKey / api）。
   * 本地模型（opencode/...）不携带。 */
  provider?: {
    baseUrl: string;
    apiKey: string;
    api: "chat/completions" | "responses";
  };
}

export class OpenChatProvider extends DeepSeekChatProvider<
  XModelMessage,
  OpenChatParams,
  XModelResponse
> {
  /** Called when the gateway emits a `web_search` event carrying source results. */
  onWebSearchSources?: (sources: WebSearchSourceItem[]) => void;

  /** Called when the gateway emits a `tool_call` event (工具调用状态变化)。 */
  onToolCall?: (tool: ToolCallItem) => void;

  /** Called when the gateway emits a `chat_error` event（上游回合失败）。 */
  onChatError?: (message: string) => void;

  /** Called when the gateway emits a `chat_notice` event（如模型请求重试提示）。 */
  onChatNotice?: (message: string) => void;

  /** Called when the gateway emits a `chat_permission` event（opencode 权限询问）。 */
  onPermissionRequest?: (request: PermissionRequest) => void;

  /** Called when a native provider assigns its real persistent session id. */
  onProviderSession?: (session: ProviderSessionNotice) => void;

  override transformMessage(info: TransformMessage<XModelMessage, XModelResponse>): XModelMessage {
    const chunk = info.chunk as { event?: string; data?: string } | undefined;

    // useXChat calls transformMessage with no chunk when the stream succeeds.
    // Preserve the accumulated message, including a search marker when the
    // model finished without emitting answer text; also finalize any unclosed
    // <think> block so the Think panel stops showing as "思考中".
    if (chunk === undefined) {
      const origin = info.originMessage ?? { content: "", role: "assistant" };
      const content = typeof origin.content === "string" ? origin.content : "";
      if (origin.reasoningContent) {
        return { ...origin, reasoningDone: true };
      }
      const split = splitReasoningContent(closeOpenThink(content));
      if (!split.hasThink) return origin;
      return preserveMessageMeta(origin, {
        role: origin.role || "assistant",
        content: split.answerContent,
        reasoningContent: split.reasoningContent,
        reasoningDone: true,
      });
    }

    if (chunk?.event === "tool_call" && chunk.data && chunk.data !== "[DONE]") {
      try {
        const tool = JSON.parse(chunk.data) as ToolCallItem;
        this.onToolCall?.(tool);
        const origin = info.originMessage ?? { content: "", role: "assistant" };
        return {
          ...origin,
          toolCalls: mergeToolCalls(origin.toolCalls, tool),
          ...(origin.reasoningContent ? { reasoningDone: true } : {}),
        };
      } catch (err) {
        console.error("Failed to parse tool_call event:", err);
      }
      return info.originMessage ?? { content: "", role: "assistant" };
    }

    if (chunk?.event === "chat_error" && chunk.data && chunk.data !== "[DONE]") {
      try {
        const parsed = JSON.parse(chunk.data) as { message?: string };
        const message = parsed.message || "请求失败";
        this.onChatError?.(message);
        const origin = info.originMessage ?? { content: "", role: "assistant" };
        return { ...origin, chatError: message };
      } catch (err) {
        console.error("Failed to parse chat_error event:", err);
      }
      return info.originMessage ?? { content: "", role: "assistant" };
    }

    if (chunk?.event === "chat_notice" && chunk.data && chunk.data !== "[DONE]") {
      try {
        const parsed = JSON.parse(chunk.data) as { message?: string };
        const notice = parsed.message || "";
        this.onChatNotice?.(notice);
        const origin = info.originMessage ?? { content: "", role: "assistant" };
        const notices = Array.isArray(origin.chatNotices) ? origin.chatNotices : [];
        const next =
          notices[notices.length - 1] === notice ? notices : [...notices, notice].slice(-5);
        return { ...origin, chatNotices: next };
      } catch (err) {
        console.error("Failed to parse chat_notice event:", err);
      }
      return info.originMessage ?? { content: "", role: "assistant" };
    }

    if (chunk?.event === "chat_permission" && chunk.data && chunk.data !== "[DONE]") {
      try {
        const permission = JSON.parse(chunk.data) as PermissionRequest;
        this.onPermissionRequest?.(permission);
        const origin = info.originMessage ?? { content: "", role: "assistant" };
        const permissions = Array.isArray(origin.pendingPermissions)
          ? origin.pendingPermissions
          : [];
        return {
          ...origin,
          pendingPermissions: [...permissions.filter((p) => p.id !== permission.id), permission],
        };
      } catch (err) {
        console.error("Failed to parse chat_permission event:", err);
      }
      return info.originMessage ?? { content: "", role: "assistant" };
    }

    if (chunk?.event === "provider_session" && chunk.data && chunk.data !== "[DONE]") {
      try {
        const session = JSON.parse(chunk.data) as ProviderSessionNotice;
        if (session.sessionId) this.onProviderSession?.(session);
      } catch (err) {
        console.error("Failed to parse provider_session event:", err);
      }
      return info.originMessage ?? { content: "", role: "assistant" };
    }

    if (chunk?.event === "acp_plan" && chunk.data && chunk.data !== "[DONE]") {
      try {
        const plan = JSON.parse(chunk.data) as Record<string, unknown>;
        const origin = info.originMessage ?? { content: "", role: "assistant" };
        return {
          ...origin,
          agentPlan: plan,
          ...(origin.reasoningContent ? { reasoningDone: true } : {}),
        };
      } catch (err) {
        console.error("Failed to parse acp_plan event:", err);
      }
      return info.originMessage ?? { content: "", role: "assistant" };
    }

    if (chunk?.event === "web_search" && chunk.data && chunk.data !== "[DONE]") {
      try {
        const parsed = JSON.parse(chunk.data) as {
          results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        const sources: WebSearchSourceItem[] = (parsed.results ?? []).map((result, index) => {
          const content = typeof result.content === "string" ? result.content : "";
          return {
            key: String(index),
            title: result.title || result.url || "",
            url: result.url || "",
            description: content.length > 160 ? `${content.slice(0, 160)}…` : content,
          };
        });
        this.onWebSearchSources?.(sources);
      } catch (err) {
        console.error("Failed to parse web_search event:", err);
      }
      // Show a searching indicator while the model consumes the results.
      const origin = info.originMessage;
      const originContent = typeof origin?.content === "string" ? origin.content : "";
      return preserveMessageMeta(origin, {
        content: originContent || WEB_SEARCHING_MARKER,
        role: "assistant",
      });
    }
    // Replace the searching marker only when this chunk contains actual
    // text/reasoning. Terminal and metadata-only frames must keep the marker,
    // otherwise the UI drops the resulting empty assistant message.
    const origin = info.originMessage;
    if (typeof origin?.content === "string" && origin.content === WEB_SEARCHING_MARKER) {
      const transformed = super.transformMessage({
        ...info,
        originMessage: { ...origin, content: "" },
      });
      const transformedContent =
        typeof transformed.content === "string"
          ? transformed.content
          : (transformed.content?.text ?? "");
      return transformedContent ? preserveMessageMeta(origin, transformed) : origin;
    }

    // 直接解析当前 chunk 的 delta，content / reasoning_content 各自精确累积，
    // 避免经 <think> 往返重建导致 chunk 边界换行被 trim / 无分隔拼接丢失。
    const originContent = getMessageText(origin?.content);
    const originReasoning =
      typeof origin?.reasoningContent === "string" ? origin.reasoningContent : "";

    let deltaContent = "";
    let deltaReasoning = "";
    try {
      if (chunk?.data && chunk.data !== "[DONE]") {
        const parsed = JSON.parse(chunk.data) as {
          choices?: Array<{
            delta?: { content?: unknown; reasoning_content?: unknown };
            message?: { content?: unknown; reasoning_content?: unknown };
          }>;
        };
        for (const choice of parsed.choices ?? []) {
          const delta = choice.delta ?? choice.message ?? {};
          deltaReasoning = getMessageText(delta.reasoning_content as XModelMessage["content"]);
          deltaContent = getMessageText(delta.content as XModelMessage["content"]);
        }
      }
    } catch (err) {
      console.error("Failed to parse stream chunk:", err);
    }

    const accumulatedContent = `${originContent}${deltaContent}`;
    const accumulatedReasoning = `${originReasoning}${deltaReasoning}`;
    // 兼容模型直接在 content 里输出 <think> 标签（DeepSeek 原生风格）。
    const split = splitReasoningContent(accumulatedContent);
    const next: XModelMessage = {
      role: origin?.role || "assistant",
      content: split.hasThink ? split.answerContent : accumulatedContent,
      ...(split.reasoningContent || accumulatedReasoning
        ? { reasoningContent: split.reasoningContent || accumulatedReasoning }
        : {}),
    };
    // 思考结束判定：<think> 闭合，或思考结束后开始输出正文。
    if (split.hasThink) {
      next.reasoningDone = split.reasoningDone;
    } else if (deltaContent && accumulatedReasoning) {
      next.reasoningDone = true;
    }
    return preserveMessageMeta(origin, next);
  }

  override transformParams(
    requestParams: Partial<OpenChatParams>,
    options: XRequestConfigOptions<OpenChatParams, XModelResponse, XModelMessage>,
  ): OpenChatParams {
    const { systemPrompt = "", web_search, ...modelRequestParams } = requestParams;
    const params = super.transformParams(modelRequestParams, options);
    delete params.systemPrompt;
    const messages = (params.messages ?? [])
      .filter((modelMessage) => modelMessage.openChatLocalOnly !== true)
      .map((modelMessage) => stripLocalMessageFields(modelMessage));
    const normalizedSystemPrompt = systemPrompt.trim();

    // `web_search: true` declares the web-search tool so the model can decide
    // whether to call it; the gateway intercepts the call, runs the configured
    // search provider (Tavily) and feeds results back to the model.
    const searchTools = web_search ? { tools: [WEB_SEARCH_TOOL], tool_choice: "auto" } : {};

    return {
      ...params,
      ...searchTools,
      messages: normalizedSystemPrompt
        ? [{ role: "system", content: normalizedSystemPrompt }, ...messages]
        : messages,
    };
  }
}

/** 按工具 id 合并流式 `tool_call` 事件（后到的完整状态覆盖旧状态）。 */
function mergeToolCalls(existing: unknown, incoming: ToolCallItem): ToolCallItem[] {
  const list = Array.isArray(existing) ? (existing as ToolCallItem[]) : [];
  const index = list.findIndex((tool) => tool.id && tool.id === incoming.id);
  if (index === -1) return [...list, incoming];
  const next = list.slice();
  next[index] = { ...next[index], ...incoming };
  return next;
}

/** 把消息上累积的工具调用 / 错误 / 提示 / 权限字段回接到转换后的消息上（super 只返回 content/role）。 */
function preserveMessageMeta(
  origin: XModelMessage | undefined,
  next: XModelMessage,
): XModelMessage {
  const meta: {
    toolCalls?: ToolCallItem[];
    chatError?: string;
    chatNotices?: string[];
    pendingPermissions?: PermissionRequest[];
    reasoningContent?: string;
    reasoningDone?: boolean;
  } = {};
  if (Array.isArray(origin?.toolCalls)) meta.toolCalls = origin.toolCalls;
  if (typeof origin?.chatError === "string") meta.chatError = origin.chatError;
  if (Array.isArray(origin?.chatNotices)) meta.chatNotices = origin.chatNotices;
  if (Array.isArray(origin?.pendingPermissions))
    meta.pendingPermissions = origin.pendingPermissions;
  if (origin?.agentPlan && typeof origin.agentPlan === "object") {
    (meta as Record<string, unknown>).agentPlan = origin.agentPlan;
  }
  if (
    typeof next.reasoningContent !== "string" &&
    typeof (origin as Record<string, unknown> | undefined)?.reasoningContent === "string"
  ) {
    meta.reasoningContent = (origin as Record<string, unknown>).reasoningContent as string;
  }
  if (
    typeof next.reasoningDone !== "boolean" &&
    typeof (origin as Record<string, unknown> | undefined)?.reasoningDone === "boolean"
  ) {
    meta.reasoningDone = (origin as Record<string, unknown>).reasoningDone as boolean;
  }
  return Object.keys(meta).length > 0 ? { ...next, ...meta } : next;
}

function getMessageText(content: XModelMessage["content"] | undefined): string {
  return typeof content === "string" ? content : content?.text || "";
}

interface SplitReasoningResult {
  hasThink: boolean;
  thinkContent: string;
  answerContent: string;
  reasoningContent: string;
  reasoningDone: boolean;
}

function splitReasoningContent(value: string): SplitReasoningResult {
  const openMatch = value.match(/<think(?:\s+status\s*=\s*["']?([^"'>\s]+)["']?)?\s*>/i);
  if (!openMatch || openMatch.index === undefined) {
    return {
      hasThink: false,
      thinkContent: "",
      answerContent: value.trim(),
      reasoningContent: "",
      reasoningDone: true,
    };
  }

  const thinkStart = openMatch.index + openMatch[0].length;
  const closeMatch = value.slice(thinkStart).match(/<\/think\s*>/i);
  const closeIndex = closeMatch ? thinkStart + (closeMatch.index ?? 0) : -1;
  const closeLength = closeMatch?.[0].length ?? 0;
  const prefix = value.slice(0, openMatch.index).trim();
  const thinkRaw =
    closeIndex === -1 ? value.slice(thinkStart) : value.slice(thinkStart, closeIndex);
  const suffix = closeIndex === -1 ? "" : value.slice(closeIndex + closeLength).trim();
  const status = (openMatch[1] || "").toLowerCase();

  return {
    hasThink: true,
    thinkContent: thinkRaw.replace(/^\s+/, "").trim(),
    answerContent: [prefix, suffix].filter(Boolean).join("\n\n").trim(),
    reasoningContent: thinkRaw.replace(/^\s+/, "").trim(),
    reasoningDone: closeIndex !== -1 || status === "done",
  };
}

function stripLocalMessageFields(message: XModelMessage): XModelMessage {
  const next = { ...message };
  delete next.reasoningContent;
  delete next.reasoningDone;
  delete next.toolCalls;
  delete next.agentPlan;
  delete next.chatError;
  delete next.chatNotices;
  delete next.pendingPermissions;
  delete next.openChatLocalOnly;
  return next;
}

/** 流结束时把未闭合的 `<think>` 标记为完成并补上闭合标签。 */
function closeOpenThink(content: string): string {
  if (!/<think\b/i.test(content)) return content;
  const openMatch = content.match(/<think(?:\s+status\s*=\s*["']?([^"'>\s]+)["']?)?\s*>/i);
  if (!openMatch) return content;
  const thinkStart = openMatch.index ?? 0;
  const status = (openMatch[1] || "").toLowerCase();
  const hasCloseTag = /<\/think\s*>/i.test(content.slice(thinkStart + openMatch[0].length));
  if (status === "done" || hasCloseTag) {
    return content;
  }
  return content.replace(/<think([^>]*)>/i, `<think$1 status="done">`) + "</think>";
}

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

/** OpenAI function-tool definition for web search. Declared in the request
 * `tools` array so the model autonomously decides whether to call it; the
 * gateway intercepts the call and runs the configured search provider. */
export const WEB_SEARCH_TOOL = {
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
  systemPrompt?: string;
  /** When true, declares a `web_search` tool in the request so the model can
   * autonomously decide whether to search. The gateway executes the call. */
  web_search?: boolean;
}

export class OpenChatProvider extends DeepSeekChatProvider<
  XModelMessage,
  OpenChatParams,
  XModelResponse
> {
  /** Called when the gateway emits a `web_search` event carrying source results. */
  onWebSearchSources?: (sources: WebSearchSourceItem[]) => void;

  override transformMessage(info: TransformMessage<XModelMessage, XModelResponse>): XModelMessage {
    const chunk = info.chunk as { event?: string; data?: string } | undefined;

    // useXChat calls transformMessage with no chunk when the stream succeeds.
    // Preserve the accumulated message, including a search marker when the
    // model finished without emitting answer text.
    if (chunk === undefined) {
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
      return {
        content: originContent || WEB_SEARCHING_MARKER,
        role: "assistant",
      };
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
      return transformedContent ? transformed : origin;
    }
    return super.transformMessage(info);
  }

  override transformParams(
    requestParams: Partial<OpenChatParams>,
    options: XRequestConfigOptions<OpenChatParams, XModelResponse, XModelMessage>,
  ): OpenChatParams {
    const { systemPrompt = "", web_search, ...modelRequestParams } = requestParams;
    const params = super.transformParams(modelRequestParams, options);
    delete params.systemPrompt;
    const messages = (params.messages ?? []).filter(
      (modelMessage) => modelMessage.openChatLocalOnly !== true,
    );
    const normalizedSystemPrompt = systemPrompt.trim();

    // `web_search: true` declares the web-search tool so the model can decide
    // whether to call it; the gateway intercepts and executes the call.
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

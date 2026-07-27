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

export const A2UI_SYSTEM_PROMPT = `You are the assistant inside Open Chat. Answer with normal Markdown by default. Only return A2UI when the user explicitly asks for an interactive UI, form, card, or structured control.

When A2UI is requested, output exactly one complete protocol block using the <a2ui> tag, opened with <a2ui> and closed with </a2ui>.
<a2ui>
[
  {"version":"v0.9","createSurface":{"surfaceId":"status-card-1","catalogId":"local://open-chat/basic"}},
  {"version":"v0.9","updateComponents":{"surfaceId":"status-card-1","components":[{"id":"root","component":"Card","title":"Service status","child":"content"},{"id":"content","component":"Column","gap":14,"children":["status-row","availability","latency","refresh"]},{"id":"status-row","component":"Row","justify":"space-between","children":["service","status-tag"]},{"id":"service","component":"Text","text":"API gateway","variant":"h3"},{"id":"status-label","component":"Text","text":"Operational"},{"id":"status-tag","component":"Tag","color":"success","child":"status-label"},{"id":"availability","component":"Progress","percent":{"path":"/availability"},"status":"success"},{"id":"latency","component":"Statistic","title":"Median latency","value":{"path":"/latency"},"suffix":"ms"},{"id":"refresh-label","component":"Text","text":"Refresh"},{"id":"refresh","component":"Button","child":"refresh-label","variant":"primary","action":{"event":{"name":"refresh","context":{"source":"status-card"}}}}]}},
  {"version":"v0.9","updateDataModel":{"surfaceId":"status-card-1","path":"/availability","value":99.9}},
  {"version":"v0.9","updateDataModel":{"surfaceId":"status-card-1","path":"/latency","value":184}}
]
</a2ui>

Strict A2UI rules:
- Every createSurface surfaceId must be unique across the entire conversation. Never reuse an ID from a submitted, locked, preserved, or deleted surface. For another similar surface, keep the semantic prefix and use the next unused positive integer suffix, then use that exact new ID consistently in every command for the surface.
- The <a2ui> tag content must be one valid JSON array. No comments, trailing commas, JavaScript syntax, or outer string quotes.
- Every array item must contain version plus exactly one of createSurface, updateComponents, updateDataModel, or deleteSurface. Never put two updateDataModel keys in one object.
- updateComponents has exactly this shape: {"surfaceId":"...","components":[...]}. Never wrap it in formCard, card, config, or another key.
- updateDataModel has exactly this shape: {"surfaceId":"...","path":"/field","value":...}. Send one updateDataModel object per array item.
- Do not invent updateContent, createComponents, cardId, componentName, config, bindingExpression, or other protocol fields.
- updateComponents.components is a flat array. Every component is an object with a unique string id and string component name.
- child is one string component ID. children is an array of string component IDs. Never put component objects inside child or children. Never declare children twice.
- Every referenced child ID must be declared as another component in the same flat array. The root component must have id root and must have a non-empty child or children. A Card must point to one child component.
- Allowed components are only Card, Column, Row, Text, TextField, Button, Divider, Alert, Tag, Statistic, and Progress.
- Prefer one compact Card with a clear title and a Column content root. Use Row only for short related items; do not place long text fields side by side.
- Use Alert for important success, warning, or error feedback; Tag for short status labels; Statistic for a prominent numeric value; and Progress only for a real percentage.
- Text variants are body, caption, secondary, h1, h2, h3, h4, success, warning, and danger. Keep heading hierarchy shallow and use caption or secondary for supporting copy.
- Text and TextField data binding uses a property value such as {"path":"/form/name"}; the same path value can be used by Alert message/description, Statistic value, and Progress percent. Do not use {name} placeholders or bindingExpression.
- TextField uses label and value. Button and Tag labels are Text child components; do not use a label object on Button or Tag.
- Card supports title and size. Column and Row support gap, align, and justify. Alert supports message, description, type, and showIcon. Statistic supports title, value, prefix, suffix, and precision.
- Button actions use {"event":{"name":"actionName","context":{...}}}. Keep context limited to action metadata such as source or record id; the host automatically attaches the complete bound data model as the submission data field.
- updateDataModel.path must be a named path such as /status, never /. Send separate updateDataModel objects for separate paths.
- When the user submits a form, the host adds an internal context message prefixed with [表单提交], followed by the action name and submitted JSON data. This internal message is persisted for the conversation but hidden from the chat UI. Process it naturally and respond with normal Markdown or new A2UI surfaces. The submitted form is already locked and preserved locally — do not attempt to update or recreate the existing form surface. Instead, create a new surface if you need to show results or next steps.
- Keep explanatory prose outside the <a2ui> block concise.`;

const formatPromptDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

export const createTicketBranchSystemPrompt = (date: Date = new Date()) => `${A2UI_SYSTEM_PROMPT}

你是一个“工单分支生成器”。当前日期是 ${formatPromptDate(date)}。

你必须按以下两阶段流程工作：

第一阶段：收集信息
- 当用户尚未提交表单时，只输出一个完整的 <a2ui> 协议块，不要输出解释、标题或 Markdown 代码块。
- 如果用户在之前的表单提交后明确要求重新填写、重试或创建新表单，也进入第一阶段并输出一张全新的空白表单。
- 表单必须包含两个必填文本字段：
  1. 工单 ID，数据路径为 /ticketId。
  2. 项目名称，数据路径为 /projectName。这里填写项目、需求或改动的名称，你要用它判断分支类型并生成 feature-name。
- 表单提交按钮的 action name 必须是 generate_ticket_branch。
- 首张表单使用 ticket-branch-form-1。如果会话中已经创建过工单表单，新表单必须使用 ticket-branch-form-N，其中 N 是下一个尚未使用的正整数后缀。
- 新表单的 createSurface、updateComponents、所有 updateDataModel 和 action context source 必须统一使用同一个新 ID。
- 只有首张表单必须原样输出下面的协议；后续表单必须仅替换其中每一处 ticket-branch-form-1 为选定的新 ID，其他字段和 action 保持不变：
<a2ui>
[
  {"version":"v0.9","createSurface":{"surfaceId":"ticket-branch-form-1","catalogId":"local://open-chat/basic"}},
  {"version":"v0.9","updateComponents":{"surfaceId":"ticket-branch-form-1","components":[{"id":"root","component":"Card","title":"生成工单分支","child":"form-content"},{"id":"form-content","component":"Column","gap":14,"children":["form-tip","ticket-id","project-name","submit"]},{"id":"form-tip","component":"Text","text":"填写工单 ID 和项目名称，系统会自动判断分支类型并生成命令。","variant":"secondary"},{"id":"ticket-id","component":"TextField","label":"工单 ID *","placeholder":"例如：123432","value":{"path":"/ticketId"}},{"id":"project-name","component":"TextField","label":"项目名称 *","placeholder":"例如：新增组织树筛选功能","value":{"path":"/projectName"}},{"id":"submit-label","component":"Text","text":"生成分支命令"},{"id":"submit","component":"Button","child":"submit-label","variant":"primary","action":{"event":{"name":"generate_ticket_branch","context":{"source":"ticket-branch-form-1","requiredPaths":["/ticketId","/projectName"]}}}}]}},
  {"version":"v0.9","updateDataModel":{"surfaceId":"ticket-branch-form-1","path":"/ticketId","value":""}},
  {"version":"v0.9","updateDataModel":{"surfaceId":"ticket-branch-form-1","path":"/projectName","value":""}}
]
</a2ui>

第二阶段：生成分支命令
- 当收到以 [表单提交] 开头、action 为 generate_ticket_branch 的消息时，读取 ticketId 和 projectName。
- 根据 projectName 自动判断分支类型：
  - feat：新增功能、增加能力、增加模块或提供新的交互。
  - fix：修复一般问题、异常、错误处理或非紧急补丁。
  - hotfix：修复需要立即上线的生产紧急问题。
  - chore：构建脚本、依赖、环境配置、项目维护等不影响业务逻辑的改动。
  - refactor：重构代码且不改变既有行为。
  - docs：文档修改。
  - test：测试相关改动。
- 把 projectName 提炼并转换为简短、清晰的小写英文 kebab-case feature-name，只保留字母、数字和连字符。
- 分支名格式严格为：<type>/<feature-name>/<YYYYMMDD>/<ticketId>。
- YYYYMMDD 必须使用上方给出的当前日期 ${formatPromptDate(date)}。
- ticketId 去除首尾空格；若包含不适合 Git 分支名的空格或斜杠，统一替换为连字符。
- 最终只能输出一个 Markdown 代码块，代码块内只能包含这一条命令：git checkout -b <branch-name>。
- Markdown 代码块必须使用 bash 作为语言标识。
- 不要输出代码块以外的解释、标题、前后缀、引号或其他内容。

正确示例：
\`\`\`bash
git checkout -b feat/new-tree/20251204/123432
\`\`\``;

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
    const messages = params.messages ?? [];
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

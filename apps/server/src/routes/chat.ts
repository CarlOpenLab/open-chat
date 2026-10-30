/**
 * 聊天 REST：`/api/chat/completions`（本地 agent / 本地 opencode / OpenAI 兼容转发）、
 * `/api/chat/permission`（权限审批回复）与 `/api/models`（模型发现）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Router, type Response } from "express";
import type { AcpPermissionMode } from "../acpManager";
import type { AgentManager } from "../agentManager";
import { ATTACHMENT_SCHEME, attachmentContentType, type AttachmentStore } from "../attachments";
import type { AppConfig } from "../config";
import { GatewayError } from "../error";
import { optionalString, parseProjectPath, sendGatewayError } from "../http";
import {
  attachAbortOnClose,
  extractTextFromMessage,
  hashKey,
  type LocalChatManager,
  type LocalModelInfo,
} from "../localProvider";
import { writeNativeEvent } from "../nativeEvents";
import {
  forwardChatRequest,
  parseRequestProvider,
  pipeUpstream,
  type ChatCompletionRequest,
  type ProviderEndpoint,
} from "../provider";
import type { SearchProvider } from "../search";
import { runSearchAgentLoop } from "../search-agent";
import type { WorkspaceStore } from "../store/workspace";

export interface ChatRouteDeps {
  config: AppConfig;
  store: WorkspaceStore;
  attachments: AttachmentStore;
  agentManager: AgentManager;
  localChat: LocalChatManager | null;
  searchProvider: SearchProvider | null;
}

/**
 * @description 创建聊天路由（挂载在 `/api/chat`）。
 * @param {ChatRouteDeps} deps - 网关运行时依赖
 * @returns {Router} Express 路由
 */
export function createChatRouter(deps: ChatRouteDeps): Router {
  const { store, attachments, agentManager, localChat, searchProvider } = deps;
  const router = Router();

  router.post("/completions", async (req, res) => {
    try {
      const body = req.body as ChatCompletionRequest;
      if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
        throw GatewayError.invalidRequest("messages array is required");
      }

      const acpAgentId =
        typeof body.acpAgentId === "string" ? body.acpAgentId.trim().toLowerCase() : "";
      if (acpAgentId) {
        return await handleAgentChat(res, body, acpAgentId, agentManager, attachments);
      }

      // 本地模型（形如 `opencode/...`）：转发到本地 opencode
      if (
        localChat &&
        typeof body.model === "string" &&
        (await localChat.isLocalModel(body.model))
      ) {
        return await handleLocalChat(res, body, localChat, attachments);
      }

      // 转发目标：优先按 providerId 从网关存储解析（Key 不经过浏览器），兼容请求体内联 provider
      const endpoint = resolveProviderEndpoint(body, store);
      // goal / instruction 为 sender 斜杠指令的单次高优输入：注入为 system 消息后剔除独立字段
      injectGoalMessages(body as unknown as Record<string, unknown>);
      delete body.provider;
      delete body.providerId;
      delete body.mode;
      delete body.permission;
      delete body.projectPath;
      delete (body as Record<string, unknown>).goal;
      delete (body as Record<string, unknown>).instruction;
      // 附件引用 → OpenAI 多模态 image_url（data URL，远端模型读不到本地路径）
      injectAttachmentsForUpstream(body.messages as unknown[], attachments);
      const stream = body.stream === true;

      // 客户端声明 `web_search` 工具时走 agent 循环：拦截工具调用并执行搜索提供方，
      // 把结果回喂给模型。其余请求原样透传。
      const canSearch =
        stream && endpoint.api === "chat/completions" && hasWebSearchTool(body.tools);

      if (canSearch && searchProvider) {
        await runSearchAgentLoop(req, res, buildStreamRequest(endpoint), body, searchProvider);
      } else {
        // 无搜索后端：剥掉工具，避免模型调用无人执行的功能
        if (canSearch) stripWebSearchTool(body);
        const upstream = await forwardChatRequest(endpoint, body);
        await pipeUpstream(req, res, upstream);
      }
    } catch (err) {
      if (res.headersSent) {
        console.error("Chat API error after headers sent:", err);
        try {
          res.end();
        } catch {
          // response already ended
        }
        return;
      }
      if (err instanceof GatewayError) return sendGatewayError(res, err);
      console.error("Chat API error:", err);
      return sendGatewayError(
        res,
        GatewayError.upstream(err instanceof Error ? err.message : "Internal server error"),
      );
    }
  });

  // 回复权限询问（允许一次 / 始终允许 / 拒绝）：ACP agent 与本地 opencode 回合共用
  router.post("/permission", async (req, res) => {
    const body = req.body as {
      conversationId?: unknown;
      permissionId?: unknown;
      response?: unknown;
      version?: unknown;
      agentId?: unknown;
    };
    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const permissionId = typeof body.permissionId === "string" ? body.permissionId.trim() : "";
    const response = body.response;
    const version = body.version === "v2" ? "v2" : "v1";
    if (!permissionId) throw GatewayError.invalidRequest("permissionId 是必填项");
    if (response !== "once" && response !== "always" && response !== "reject") {
      throw GatewayError.invalidRequest("response 必须是 once / always / reject");
    }
    try {
      if (body.version === "acp") {
        const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
        if (!agentId) throw GatewayError.invalidRequest("agentId 是必填项");
        await agentManager.replyPermission(agentId, permissionId, response);
        res.json({ ok: true });
        return;
      }
      if (!conversationId) throw GatewayError.invalidRequest("conversationId 是必填项");
      if (!localChat) throw GatewayError.invalidRequest("本地 OpenCode AI 未启用");
      await localChat.replyPermission(conversationId, permissionId, response, version);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      console.error("Permission reply error:", err);
      throw GatewayError.upstream(err instanceof Error ? err.message : "权限回复失败");
    }
  });

  return router;
}

/**
 * @description 创建模型发现路由（挂载在 `/api/models`）：联网搜索能力 + 本地 opencode 发现的模型。
 * 手动配置的服务商模型由 `/api/providers` 提供，前端合并展示。
 * @param {ChatRouteDeps} deps - 网关运行时依赖
 * @returns {Router} Express 路由
 */
export function createModelsRouter(deps: ChatRouteDeps): Router {
  const { config, localChat, searchProvider } = deps;
  const router = Router();

  router.get("/", async (_req, res) => {
    let local: { enabled: boolean; provider: string; models: LocalModelInfo[]; error?: string } = {
      enabled: false,
      provider: "",
      models: [],
    };
    if (localChat && config.local.enabled) {
      try {
        const models = await localChat.listModels();
        local = { enabled: true, provider: models[0]?.provider ?? "opencode", models };
      } catch (err) {
        console.error("Local opencode model discovery failed:", err);
        local = {
          enabled: false,
          provider: "",
          models: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    res.json({
      search: { enabled: !!searchProvider, provider: searchProvider?.name ?? "" },
      local,
    });
  });

  return router;
}

/**
 * @description 解析 OpenAI 兼容转发目标：providerId → 网关存储中的服务商；否则读取请求体内联的 provider。
 * @param {ChatCompletionRequest} body - 聊天请求体
 * @param {WorkspaceStore} store - 工作区存储
 * @returns {ProviderEndpoint} 转发目标
 * @throws {GatewayError} 服务商不存在或未配置 Key 时抛出 400
 */
function resolveProviderEndpoint(
  body: ChatCompletionRequest,
  store: WorkspaceStore,
): ProviderEndpoint {
  const providerId = optionalString(body.providerId);
  if (!providerId) return parseRequestProvider(body);
  const provider = store.providers.get(providerId);
  if (!provider) throw GatewayError.invalidRequest(`服务商不存在：${providerId}`);
  if (!provider.apiKey)
    throw GatewayError.invalidRequest(`服务商「${provider.name}」未配置 API Key`);
  return { baseUrl: provider.baseUrl, apiKey: provider.apiKey, api: provider.api };
}

/**
 * @description 本地 agent 回合：把最后一条用户消息（含 goal / 附件 mention）交给 agentManager，输出 native_event 流。
 * @param {Response} res - Express 响应（SSE）
 * @param {ChatCompletionRequest} body - 聊天请求体
 * @param {string} agentId - agent id
 * @param {AgentManager} agentManager - 本地 agent 管理器
 * @param {AttachmentStore} attachments - 附件存储
 * @returns {Promise<void>} 回合结束
 */
async function handleAgentChat(
  res: Response,
  body: ChatCompletionRequest,
  agentId: string,
  agentManager: AgentManager,
  attachments: AttachmentStore,
): Promise<void> {
  const messages = body.messages as Array<{ role?: unknown; content?: unknown }>;
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const rawGoal =
    typeof (body as Record<string, unknown>).goal === "string"
      ? String((body as Record<string, unknown>).goal).trim()
      : "";
  const rawInstruction =
    typeof (body as Record<string, unknown>).instruction === "string"
      ? String((body as Record<string, unknown>).instruction).trim()
      : "";
  // Oh My Pi 优先：goal 与 review 均以高优 system 上下文注入，Pi 系对 [GOAL]/[REVIEW] 前缀有更明确的执行语义
  const isOhMyPi = agentId === "pi" || agentId === "omp";
  let goalPrefix = "";
  if (rawGoal || rawInstruction) {
    // 区分 goal 与 review/instruction，若仅 instruction 有值且疑似 review，则用 [REVIEW]（Oh My Pi 专用）
    const isReviewLike =
      !rawGoal && rawInstruction && /review|复审/i.test(rawInstruction.slice(0, 20));
    if (isOhMyPi && isReviewLike) {
      goalPrefix = `[REVIEW]\n${rawInstruction}\n\n`;
    } else {
      const goalBlock = [rawGoal, rawInstruction].filter(Boolean).join("\n\n");
      goalPrefix = isOhMyPi ? `[OH_MY_PI_GOAL]\n${goalBlock}\n\n` : `[GOAL]\n${goalBlock}\n\n`;
    }
  }
  const userText = lastUser ? extractTextFromMessage(lastUser as unknown) : "";
  const text = [goalPrefix + userText, ...attachmentMentions(messages, attachments)]
    .filter(Boolean)
    .join(" ");
  if (!text.trim()) throw GatewayError.invalidRequest("本地 Agent 需要至少一条 user 消息");
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim()
      ? body.conversationId.trim()
      : hashKey(messages.map((message) => extractTextFromMessage(message as unknown)));
  const projectPath = parseProjectPath(body.projectPath);
  const providerSessionId = optionalString(body.providerSessionId);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  try {
    await agentManager.runTurn(
      agentId,
      conversationId,
      text,
      projectPath,
      providerSessionId,
      res,
      parsePermissionMode(body.permission),
    );
  } catch (err) {
    // 刷新页面只断开本响应，网关托管的回合继续运行，可经 /api/acp/session/stream 重新订阅；
    // 这里的 AbortError 只来自显式取消接口。acp-hub 把取消包成
    // AdapterError('prompt_failed', 'Prompt aborted')，真正的 AbortError 放在 cause 上。
    const abortCause =
      err instanceof Error && err.cause instanceof DOMException && err.cause.name === "AbortError";
    if ((err instanceof Error && err.name === "AbortError") || abortCause) return;
    console.error(`Agent ${agentId} error:`, err);
    const message = err instanceof Error ? err.message : String(err);
    if (!res.writableEnded && !res.destroyed) {
      writeNativeEvent(res, { type: "turn.failed", message });
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}

/**
 * @description 本地 opencode 回合：按 conversationId 复用 opencode 长会话，只发最后一条用户消息，输出 native_event 流。
 * @param {Response} res - Express 响应（SSE）
 * @param {ChatCompletionRequest} body - 聊天请求体
 * @param {LocalChatManager} localChat - 本地 opencode 管理器
 * @param {AttachmentStore} attachments - 附件存储
 * @returns {Promise<void>} 回合结束
 */
async function handleLocalChat(
  res: Response,
  body: ChatCompletionRequest,
  localChat: LocalChatManager,
  attachments: AttachmentStore,
): Promise<void> {
  const model = body.model as string;
  const messages = body.messages;
  // system prompt 经前端 transformParams 合并进了 messages[0]（role: system），这里从 messages 里提取
  const baseSystemPrompt = messages
    .filter((m) => (m as { role?: unknown }).role === "system")
    .map((m) => extractTextFromMessage(m as unknown))
    .filter((text) => text.trim().length > 0)
    .join("\n");
  const rawGoal =
    typeof (body as Record<string, unknown>).goal === "string"
      ? String((body as Record<string, unknown>).goal).trim()
      : "";
  const rawInstruction =
    typeof (body as Record<string, unknown>).instruction === "string"
      ? String((body as Record<string, unknown>).instruction).trim()
      : "";
  const goalBlock = [rawGoal, rawInstruction].filter(Boolean).join("\n\n");
  const systemPrompt = goalBlock
    ? `[GOAL]\n${goalBlock}${baseSystemPrompt ? `\n\n${baseSystemPrompt}` : ""}`
    : baseSystemPrompt;
  const lastUser = [...messages].reverse().find((m) => (m as { role?: unknown }).role === "user");
  const text = [
    lastUser ? extractTextFromMessage(lastUser as unknown) : "",
    ...attachmentMentions(messages, attachments),
  ]
    .filter(Boolean)
    .join(" ");
  if (!text.trim()) throw GatewayError.invalidRequest("本地模型需要至少一条 user 消息");
  const conversationId = (body as Record<string, unknown>).conversationId;
  const key =
    typeof conversationId === "string" && conversationId.trim()
      ? conversationId.trim()
      : hashKey([systemPrompt, ...messages.map((m) => extractTextFromMessage(m as unknown))]);
  const projectPath = parseProjectPath((body as Record<string, unknown>).projectPath);

  const session = await localChat.getOrCreateSession(key, model, projectPath);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const abort = attachAbortOnClose(res);
  try {
    await localChat.runTurn(session, text, model, systemPrompt, res, abort.signal);
  } catch (err) {
    // 客户端断开：静默结束（runTurn 已中断本地回合）
    if (abort.signal.aborted) return;
    console.error("Local chat error:", err);
    try {
      const message = err instanceof Error ? err.message : String(err);
      writeNativeEvent(res, { type: "turn.failed", message });
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      // response already ended
    }
  }
}

/**
 * @description 构造 agent 循环用的上游流请求：非 2xx 转成 GatewayError（与透传一致），返回 SSE body。
 * @param {ProviderEndpoint} endpoint - 转发目标
 * @returns {(requestBody: ChatCompletionRequest) => Promise<ReadableStream<Uint8Array>>} 流请求函数
 */
function buildStreamRequest(endpoint: ProviderEndpoint) {
  return async (requestBody: ChatCompletionRequest): Promise<ReadableStream<Uint8Array>> => {
    const upstream = await forwardChatRequest(endpoint, requestBody);
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      throw GatewayError.upstream(
        `upstream ${endpoint.api} request failed with status ${upstream.status}: ${text}`,
      );
    }
    if (!upstream.body) {
      throw GatewayError.upstream(`No response body from upstream ${endpoint.api} stream`);
    }
    return upstream.body;
  };
}

/**
 * @description 判断工具声明是否为 `web_search` 函数工具。
 * @param {unknown} tool - 工具声明
 * @returns {boolean} 是 web_search 时为 true
 */
function isWebSearchTool(tool: unknown): boolean {
  if (typeof tool !== "object" || tool === null) return false;
  const fn = (tool as { function?: unknown }).function;
  return typeof fn === "object" && fn !== null && (fn as { name?: unknown }).name === "web_search";
}

/**
 * @description 判断请求 tools 是否声明了 web_search。
 * @param {unknown} tools - 请求的 tools 字段
 * @returns {boolean} 声明时为 true
 */
function hasWebSearchTool(tools: unknown): boolean {
  return Array.isArray(tools) && tools.some(isWebSearchTool);
}

/**
 * @description 无搜索后端时从请求中移除 web_search 工具。
 * @param {ChatCompletionRequest} body - 聊天请求体（原地修改）
 * @returns {void}
 */
function stripWebSearchTool(body: ChatCompletionRequest): void {
  const tools = body.tools;
  if (!Array.isArray(tools)) return;
  const filtered = tools.filter((tool) => !isWebSearchTool(tool));
  if (filtered.length === 0) delete body.tools;
  else body.tools = filtered;
}

/**
 * @description 解析请求携带的权限模式；缺省 / 非法值回落到 supervised（人工审批）。
 * @param {unknown} value - 原始值
 * @returns {AcpPermissionMode} 权限模式
 */
function parsePermissionMode(value: unknown): AcpPermissionMode {
  return value === "full" || value === "auto" ? value : "supervised";
}

/**
 * @description 收集最后一条 user 消息携带的附件引用。
 * @param {unknown[]} messages - OpenAI 格式消息
 * @returns {Array<{ reference: string; name: string }>} 合法附件引用
 */
function extractAttachments(messages: unknown[]): Array<{ reference: string; name: string }> {
  const user = [...messages].reverse().find((message) => {
    const role = (message as { role?: unknown } | null)?.role;
    return role === "user";
  });
  if (!user || typeof user !== "object") return [];
  const list = (user as { attachments?: unknown }).attachments;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const reference = (item as { reference?: unknown }).reference;
    const name = (item as { name?: unknown }).name;
    if (typeof reference !== "string" || !reference.startsWith(ATTACHMENT_SCHEME)) return [];
    if (typeof name !== "string" || !name.trim()) return [];
    return [{ reference, name: name.trim() }];
  });
}

/**
 * @description 把附件解析为网关侧绝对路径的 `@路径` mention，供同机 agent 直接读取。
 * @param {unknown[]} messages - OpenAI 格式消息
 * @param {AttachmentStore} store - 附件存储
 * @returns {string[]} mention 列表
 */
function attachmentMentions(messages: unknown[], store: AttachmentStore): string[] {
  return extractAttachments(messages).flatMap(({ reference, name }) => {
    const directory = store.pathFor(reference);
    if (!directory) return [];
    const file = join(directory, name);
    return existsSync(file) ? [`@${file}`] : [];
  });
}

/**
 * @description 透传上游前把消息里的附件引用注入为 OpenAI 多模态 image_url（data URL）。
 * @param {unknown[]} messages - OpenAI 格式消息（原地修改）
 * @param {AttachmentStore} store - 附件存储
 * @returns {void}
 */
function injectAttachmentsForUpstream(messages: unknown[], store: AttachmentStore): void {
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const record = message as { content?: unknown; attachments?: unknown };
    if (!Array.isArray(record.attachments)) continue;
    const attachments = extractAttachments([record]);
    delete record.attachments;
    if (attachments.length === 0) continue;

    const parts: unknown[] = [];
    const text = extractTextFromMessage(record);
    if (text.trim()) parts.push({ type: "text", text });
    for (const { reference, name } of attachments) {
      try {
        const bytes = store.read(reference, name);
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${attachmentContentType(name)};base64,${bytes.toString("base64")}`,
          },
        });
      } catch {
        // 附件缺失时跳过，保留文本继续发送
      }
    }
    if (parts.length > 0) record.content = parts;
  }
}

/**
 * @description Sender 斜杠指令（/goal 等）注入：把独立字段转为最高优先级 system 消息。
 * @param {Record<string, unknown>} body - 聊天请求体（原地修改）
 * @returns {void}
 */
function injectGoalMessages(body: Record<string, unknown>): void {
  const rawGoal = typeof body.goal === "string" ? body.goal.trim() : "";
  const rawInstruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const block = [rawGoal, rawInstruction].filter(Boolean).join("\n\n");
  if (!block) return;
  const messages = body.messages;
  if (!Array.isArray(messages)) return;
  // 已通过前端 transformParams 注入过则不再重复
  const alreadyHasGoal = messages.some((item) => {
    if (typeof item !== "object" || item === null) return false;
    if (!("content" in item)) return false;
    const content = (item as { content: unknown }).content;
    return typeof content === "string" && content.includes("[GOAL]");
  });
  if (alreadyHasGoal) return;
  messages.unshift({ role: "system", content: `[GOAL]\n${block}` });
}

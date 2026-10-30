/**
 * 看板 AI 助手：独立会话（conversationId "board-assistant"）由本地 ACP agent
 * 驱动。agent 经 curl 调用网关 /api/board/tasks 读写任务；本模块负责发起回合、
 * 解析 SSE 流、以及助手会话元数据（agentId / providerSessionId）的持久化。
 */
import type { BoardAssistantSession } from "@cc-heart/open-chat-types";
import { apiRequest, gatewayFetch, readErrorMessage } from "./http";
import { preferencesApi } from "./workspaceApi";

export const BOARD_ASSISTANT_CONVERSATION_ID = "board-assistant";

/**
 * @description 读取助手会话归属（工作区偏好 boardAssistant）。
 * @returns {Promise<BoardAssistantSession | null>} 已保存的会话；未使用过助手时为 null
 */
export async function loadBoardAssistantState(): Promise<BoardAssistantSession | null> {
  return (await preferencesApi.get()).boardAssistant;
}

/**
 * @description 保存助手会话归属；失败只记录日志（下次回合结束会再次保存）。
 * @param {BoardAssistantSession} state - agent 与 ACP 会话 id
 * @returns {Promise<void>}
 */
export async function saveBoardAssistantState(state: BoardAssistantSession): Promise<void> {
  try {
    await preferencesApi.update({ boardAssistant: state });
  } catch (error) {
    console.error("Failed to persist board assistant state:", error);
  }
}

/**
 * 首轮注入的系统指令：教 agent 用看板 REST API 管理任务。
 * ACP 会话在服务端持有上下文，同一会话后续轮次无需重复注入。
 */
export const BOARD_ASSISTANT_PROMPT = `你是「看板任务助手」，通过本地网关的 REST API 管理用户的任务看板。Base URL: http://127.0.0.1:8082

## API

GET    /api/board/tasks              查看全部任务 → {"tasks":[...]}
POST   /api/board/tasks              创建任务（body 见下）→ {"task":{...}}
PATCH  /api/board/tasks/{id}         更新任务（只传要改的字段）→ {"task":{...}}
DELETE /api/board/tasks/{id}         删除任务 → {"ok":true}（必须在请求体带 "confirmed":true，见规则）

创建 body 示例：
{"title":"修复登录页样式","status":"todo","priority":"P1","tags":["bug"],"dueAt":null,"description":"","projectPath":null}
未提供的字段服务端会补默认值。status: todo|doing|review|done|archived；priority: P0|P1|P2|P3 或 null（无优先级）。

## Task 字段

title: string（任务标题）· status: 看板列（todo 待办 / doing 进行中 / review 待验收 / done 已完成 / archived 已归档）· priority: P0 紧急 > P1 高 > P2 中 > P3 低，可空 · tags: 字符串数组 · dueAt: 截止时间的 epoch 毫秒时间戳，可空 · description: markdown 备注 · projectPath: 项目目录字符串，可空 · id/createdAt/updatedAt: 服务端管理，不要自己填。

## 规则

- 用 curl 调用，例如：curl -s -X POST http://127.0.0.1:8082/api/board/tasks -H 'Content-Type: application/json' -d '{"title":"..."}'
- 创建多个任务（拆分需求）时连续 POST 即可；创建前先 GET 一遍看板，避免建重复任务。
- 用户用模糊说法指代任务（"那个 bug""第二个"）时，先 GET 确认是哪个 id 再操作。
- 截止日期：用户说"今天/明天/周五"这类相对日期时，换算成当天本地 00:00 的 epoch 毫秒。
- 删除是危险操作，API 有硬门槛：必须先把要删的任务 id + 标题列给用户、等用户明确回复确认后，才发 DELETE 并在请求体带 "confirmed":true（curl -X DELETE ... -d '{"confirmed":true}'）。未确认就发 DELETE 会被 400 拒绝。用户说了"删除"但还没确认你的列单时，绝不能发 confirmed:true。
- 用户只是聊天/提问时正常回答，不一定要调 API；涉及"看板/任务"的操作才走 API。
- 完成后用简短中文总结做了什么（新建/修改/删除了哪些任务）。`;

/** 权限询问（ACP bash 等工具审批），经 chat_permission 帧到达。 */
export interface BoardAssistantPermission {
  id: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
}

export type BoardAssistantTurnOutcome = "completed" | "failed" | "aborted";

interface NativeEvent {
  type?: string;
  content?: string;
  message?: string;
  activity?: { name?: string };
}

export interface BoardAssistantTurnCallbacks {
  onDelta: (text: string) => void;
  onToolActivity: () => void;
  onPermission: (permission: BoardAssistantPermission) => void;
}

export interface BoardAssistantTurnResult {
  outcome: BoardAssistantTurnOutcome;
  errorText?: string;
}

/** 发起一个助手回合并消费响应 SSE 流（content.delta / chat_permission / turn.*）。 */
export async function runBoardAssistantTurn(options: {
  agentId: string;
  text: string;
  /** 首轮注入 BOARD_ASSISTANT_PROMPT。 */
  bootstrap: boolean;
  /** 已持久化的 ACP 会话 id：传入则网关照原会话恢复（历史/上下文续上）。 */
  providerSessionId?: string;
  callbacks: BoardAssistantTurnCallbacks;
  signal: AbortSignal;
}): Promise<BoardAssistantTurnResult> {
  const response = await gatewayFetch("/api/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      acpAgentId: options.agentId,
      conversationId: BOARD_ASSISTANT_CONVERSATION_ID,
      projectPath: "",
      ...(options.providerSessionId?.trim()
        ? { providerSessionId: options.providerSessionId.trim() }
        : {}),
      stream: true,
      messages: [
        {
          role: "user",
          content: options.bootstrap
            ? `${BOARD_ASSISTANT_PROMPT}\n\n——\n\n用户的第一条消息：${options.text}`
            : options.text,
        },
      ],
    }),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    return { outcome: "failed", errorText: await readErrorMessage(response, "回合启动失败") };
  }

  let outcome: BoardAssistantTurnOutcome = "completed";
  let errorText = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let separator: number;
      while ((separator = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        if (!frame.trim() || frame.startsWith(":")) continue;
        let event: string | null = null;
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice("event:".length).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
        }
        if (dataLines.length === 0) continue;
        const data = dataLines.join("\n");
        if (data === "[DONE]") {
          await reader.cancel().catch(() => {});
          return { outcome, ...(errorText ? { errorText } : {}) };
        }
        if (event === "native_event") {
          let native: NativeEvent;
          try {
            native = JSON.parse(data) as NativeEvent;
          } catch {
            continue;
          }
          if (native.type === "content.delta" && native.content) {
            options.callbacks.onDelta(native.content);
          } else if (native.type === "activity.upsert") {
            options.callbacks.onToolActivity();
          } else if (native.type === "turn.failed") {
            outcome = "failed";
            errorText = native.message || "回合失败";
          } else if (native.type === "turn.completed") {
            outcome = "completed";
          }
        } else if (event === "chat_permission") {
          try {
            const raw = JSON.parse(data) as {
              id?: string;
              metadata?: { title?: string };
              options?: Array<{ optionId: string; name: string; kind: string }>;
            };
            if (typeof raw.id === "string") {
              options.callbacks.onPermission({
                id: raw.id,
                title: raw.metadata?.title || "工具权限",
                options: Array.isArray(raw.options) ? raw.options : [],
              });
            }
          } catch {
            // 忽略坏帧
          }
        }
      }
    }
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return { outcome: "aborted" };
    throw error;
  }
  return { outcome, ...(errorText ? { errorText } : {}) };
}

/** 回复权限询问（version "acp" 走 agentManager.replyPermission）。 */
export async function replyBoardAssistantPermission(
  agentId: string,
  permissionId: string,
  response: "once" | "always" | "reject",
): Promise<void> {
  await apiRequest("/api/chat/permission", {
    method: "POST",
    json: { agentId, permissionId, response, version: "acp" },
    errorMessage: "权限回复失败",
  });
}

/**
 * @description 取消运行中的助手回合。
 * @param {string} agentId - 助手使用的 agent id
 * @returns {Promise<void>}
 */
export async function cancelBoardAssistantTurn(agentId: string): Promise<void> {
  await apiRequest("/api/acp/session/cancel", {
    method: "POST",
    json: { agentId, conversationId: BOARD_ASSISTANT_CONVERSATION_ID },
    errorMessage: "取消失败",
  });
}

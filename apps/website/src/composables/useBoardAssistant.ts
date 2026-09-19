/**
 * 看板 AI 助手状态与回合驱动：消息流、agent 选择、SSE 回合、权限审批。
 * 历史不本地持久化——打开抽屉时从网关 ACP 会话（omp 落盘）水合。
 */
import { onBeforeUnmount, ref, type Ref } from "vue";
import { loadAcpSession } from "../services/acp";
import {
  BOARD_ASSISTANT_CONVERSATION_ID,
  cancelBoardAssistantTurn,
  loadBoardAssistantState,
  replyBoardAssistantPermission,
  runBoardAssistantTurn,
  saveBoardAssistantState,
  type BoardAssistantPermission,
  type BoardAssistantState,
} from "../services/boardAssistant";

export interface BoardAssistantMessage {
  role: "user" | "assistant" | "error";
  content: string;
  /** 流式接收中。 */
  streaming?: boolean;
}

export function useBoardAssistant(options: { onTasksMutated?: () => void } = {}) {
  const messages: Ref<BoardAssistantMessage[]> = ref([]);
  const running = ref(false);
  const toolActivityCount = ref(0);
  const pendingPermission: Ref<BoardAssistantPermission | null> = ref(null);
  const agentId = ref("omp");
  const ready = ref(false);

  /** 首轮是否注入系统指令（由 providerSessionId 是否已知推断）。 */
  let bootstrapped = false;
  /** 持久化的 ACP 会话 id：跨刷新/网关重启恢复历史与上下文。 */
  let providerSessionId = "";
  let activeController: AbortController | null = null;

  async function init(): Promise<void> {
    const state = await loadBoardAssistantState();
    if (state) {
      agentId.value = state.agentId;
      providerSessionId =
        typeof state.providerSessionId === "string" ? state.providerSessionId : "";
      bootstrapped = Boolean(providerSessionId);
    }
    ready.value = true;
  }

  /** 从网关 ACP 会话水合历史（user / content 片段；思考与工具不展示）。 */
  async function hydrate(): Promise<void> {
    if (messages.value.length > 0) return;
    try {
      const session = await loadAcpSession(
        agentId.value,
        BOARD_ASSISTANT_CONVERSATION_ID,
        "",
        providerSessionId,
      );
      if (typeof session.sessionId === "string" && session.sessionId) {
        providerSessionId = session.sessionId;
        bootstrapped = true;
        await persistState(session.sessionId);
      }
      const history: BoardAssistantMessage[] = [];
      for (const message of session.messages ?? []) {
        if (message.role === "user") {
          history.push({ role: "user", content: message.content });
        } else if (message.role === "content") {
          history.push({ role: "assistant", content: message.content });
        }
      }
      messages.value = history;
    } catch {
      // 会话不存在（首次使用）属正常，静默
    }
  }

  async function persistState(providerSessionId?: string): Promise<void> {
    const state: BoardAssistantState = { agentId: agentId.value };
    if (providerSessionId) state.providerSessionId = providerSessionId;
    await saveBoardAssistantState(state);
  }

  async function setAgent(next: string): Promise<void> {
    if (next === agentId.value) return;
    // 换 agent 即换会话：清空消息，下一条重新注入指令
    agentId.value = next;
    bootstrapped = false;
    providerSessionId = "";
    messages.value = [];
    await persistState();
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || running.value) return;
    messages.value = [
      ...messages.value,
      { role: "user", content: trimmed },
      { role: "assistant", content: "", streaming: true },
    ];
    running.value = true;
    toolActivityCount.value = 0;
    pendingPermission.value = null;
    const controller = new AbortController();
    activeController = controller;
    const assistantIndex = messages.value.length - 1;
    try {
      const result = await runBoardAssistantTurn({
        agentId: agentId.value,
        text: trimmed,
        bootstrap: !bootstrapped,
        providerSessionId,
        signal: controller.signal,
        callbacks: {
          onDelta: (delta) => {
            const current = messages.value[assistantIndex];
            if (current) current.content += delta;
          },
          onToolActivity: () => {
            toolActivityCount.value += 1;
          },
          onPermission: (permission) => {
            pendingPermission.value = permission;
          },
        },
      });
      const current = messages.value[assistantIndex];
      if (current) current.streaming = false;
      if (result.outcome === "failed") {
        const detail = result.errorText ? `：${result.errorText}` : "";
        messages.value = [
          ...messages.value.slice(0, assistantIndex),
          { role: "error", content: `回合失败${detail}` },
        ];
      } else if (result.outcome === "completed") {
        bootstrapped = true;
        void persistSessionId();
        options.onTasksMutated?.();
      }
    } catch (error) {
      const current = messages.value[assistantIndex];
      if (current) current.streaming = false;
      if ((error as Error)?.name !== "AbortError") {
        messages.value = [
          ...messages.value.slice(0, assistantIndex),
          { role: "error", content: `请求失败：${(error as Error).message}` },
        ];
      }
    } finally {
      running.value = false;
      activeController = null;
      pendingPermission.value = null;
    }
  }

  /** 回合结束后从 /api/acp/session 取 ACP 会话 id 持久化（跨刷新续会话）。 */
  async function persistSessionId(): Promise<void> {
    try {
      const session = await loadAcpSession(
        agentId.value,
        BOARD_ASSISTANT_CONVERSATION_ID,
        "",
        providerSessionId,
      );
      if (typeof session.sessionId === "string" && session.sessionId) {
        providerSessionId = session.sessionId;
        await persistState(session.sessionId);
      }
    } catch {
      // 下次回合会重试
    }
  }

  async function stop(): Promise<void> {
    activeController?.abort();
    await cancelBoardAssistantTurn(agentId.value);
  }

  async function replyPermission(response: "once" | "always" | "reject"): Promise<void> {
    const permission = pendingPermission.value;
    if (!permission) return;
    pendingPermission.value = null;
    try {
      await replyBoardAssistantPermission(agentId.value, permission.id, response);
    } catch (error) {
      messages.value = [
        ...messages.value,
        { role: "error", content: `权限回复失败：${(error as Error).message}` },
      ];
    }
  }

  onBeforeUnmount(() => {
    activeController?.abort();
  });

  return {
    messages,
    running,
    toolActivityCount,
    pendingPermission,
    agentId,
    ready,
    init,
    hydrate,
    setAgent,
    send,
    stop,
    replyPermission,
  };
}

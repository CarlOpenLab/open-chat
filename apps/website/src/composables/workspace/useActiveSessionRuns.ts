import { computed, shallowReactive, type ComputedRef, type Ref } from "vue";
import type { AcpRunStateNotice, OpenChatProvider } from "../../services/OpenChatProvider";
import type { OpenChatConversation } from "../useChatPersistence";

/** 一次运行中的回合：本地发起的持有 provider，刷新后恢复的没有句柄。 */
export interface ActiveSessionRun {
  conversationKey: string;
  agentId: string;
  modelId: string;
  startedAt: number;
  /** 刷新页面后恢复的运行没有本地 XRequest 句柄，只能用服务端取消接口停止。 */
  provider: OpenChatProvider | null;
  abort: () => void;
  outcome: "pending" | "error" | "abort" | null;
  errorText: string | null;
}

export interface UseActiveSessionRunsDeps {
  conversationList: Ref<OpenChatConversation[]>;
  currentConversationKey: Ref<string>;
  activeAgentId: Ref<string>;
  /** ACP 协议 agent：服务端的 running 状态同样算作运行中。 */
  usesAcpProtocol: ComputedRef<boolean>;
  acpRunState: Ref<AcpRunStateNotice | null>;
}

/**
 * 多会话并发运行状态：维护「哪些会话正在跑回合」以及起始时间。
 *
 * 这是「工作中」指示、停止按钮、队列守卫的共用数据源。
 * 页面刷新后本地 Map 为空，`restoreActiveRun` 依据服务端返回的运行记录补登记。
 */
export function useActiveSessionRuns(deps: UseActiveSessionRunsDeps) {
  const { conversationList, currentConversationKey, activeAgentId, usesAcpProtocol, acpRunState } =
    deps;

  const activeSessionRuns = shallowReactive(new Map<string, ActiveSessionRun>());

  /**
   * Provider 的历史记录常常省略一次瞬时失败的 assistant 消息。
   * 在用户显式操作前，保留本地实时消息为准（禁止被过期历史覆盖）。
   * 由会话刷新与回合收尾两侧共同维护。
   */
  const failedHistoryRefreshLocks = new Set<string>();
  /** 用户手动停止过的会话：收尾时据此判定「已停止」而非「出错」。 */
  const manuallyStoppedConversationKeys = new Set<string>();

  /**
   * @description 读取某个会话的运行记录。
   * @param {string} conversationKey - 会话 key
   * @returns {ActiveSessionRun | undefined} 运行记录；未运行时为 undefined
   */
  const getRun = (conversationKey: string): ActiveSessionRun | undefined =>
    activeSessionRuns.get(conversationKey);

  /**
   * @description 登记一次运行。
   * @param {string} conversationKey - 会话 key
   * @param {ActiveSessionRun} run - 运行记录
   * @returns {void}
   */
  const setRun = (conversationKey: string, run: ActiveSessionRun): void => {
    activeSessionRuns.set(conversationKey, run);
  };

  /**
   * @description 结束并移除一次运行。
   * @param {string} conversationKey - 会话 key
   * @returns {void}
   */
  const clearRun = (conversationKey: string): void => {
    activeSessionRuns.delete(conversationKey);
  };

  /**
   * @description 把服务端仍在运行、但本地没有句柄的回合登记进来。
   *   刷新页面后本地 `activeSessionRuns` 是空的，「工作中」指示、停止按钮、
   *   队列守卫都依赖它；这里只补登记，不伪造 provider（流由实时流订阅重新挂接）。
   *   已存在的条目保持不动，避免覆盖真实句柄与起始时间。
   * @param {string} conversationKey - 会话 key
   * @param {number} startedAt - 服务端记录的回合起始时间
   * @returns {void}
   */
  const restoreActiveRun = (conversationKey: string, startedAt: number): void => {
    if (!conversationKey || activeSessionRuns.has(conversationKey)) return;
    const conversation = conversationList.value.find(
      (item) => String(item.key) === conversationKey,
    );
    setRun(conversationKey, {
      conversationKey,
      agentId: conversation?.agentId || activeAgentId.value,
      modelId: conversation?.modelId || "",
      startedAt,
      provider: null,
      // 没有本地 XRequest：停止只能通过服务端取消接口。
      abort: () => {},
      outcome: "pending",
      errorText: null,
    });
  };

  /**
   * @description 服务端确认某会话已无运行回合时，清理刷新后恢复的占位记录。
   *   带本地 provider 的运行不动：那是本页发起的真实回合，服务端可能尚未登记，
   *   删除会让指示器闪断。
   * @param {string} conversationKey - 会话 key
   * @returns {void}
   */
  const dropRestoredRun = (conversationKey: string): void => {
    if (activeSessionRuns.get(conversationKey)?.provider === null) {
      activeSessionRuns.delete(conversationKey);
    }
  };

  /**
   * @description 判断会话当前是否在运行。
   * @param {string} conversationKey - 会话 key
   * @returns {boolean} 运行中为 true
   */
  const isConversationRunning = (conversationKey: string): boolean => {
    if (!conversationKey) return false;
    if (activeSessionRuns.has(conversationKey)) return true;
    return (
      conversationKey === currentConversationKey.value &&
      usesAcpProtocol.value &&
      acpRunState.value?.state === "running"
    );
  };

  const isCurrentConversationRunning = computed(() =>
    isConversationRunning(currentConversationKey.value),
  );

  /** 各会话的运行起点：驱动侧栏的「工作中 · Ns」。 */
  const conversationBusyStates = computed<Record<string, { startedAt: number }>>(() => {
    const states: Record<string, { startedAt: number }> = {};
    for (const [key, run] of activeSessionRuns.entries()) {
      states[key] = { startedAt: run.startedAt };
    }
    return states;
  });

  /** 当前会话的运行起点；聊天区与侧栏共用这一份时间。 */
  const currentConversationBusyState = computed(() =>
    currentConversationKey.value
      ? conversationBusyStates.value[currentConversationKey.value]
      : undefined,
  );

  return {
    activeSessionRuns,
    failedHistoryRefreshLocks,
    manuallyStoppedConversationKeys,
    getRun,
    setRun,
    clearRun,
    restoreActiveRun,
    dropRestoredRun,
    isConversationRunning,
    isCurrentConversationRunning,
    conversationBusyStates,
    currentConversationBusyState,
  };
}

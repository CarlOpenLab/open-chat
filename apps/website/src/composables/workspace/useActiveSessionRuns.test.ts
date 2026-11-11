/// <reference types="vite-plus/test/globals" />

import { computed, ref } from "vue";
import type { AcpRunStateNotice } from "../../services/OpenChatProvider";
import type { OpenChatConversation } from "../useChatPersistence";
import { useActiveSessionRuns } from "./useActiveSessionRuns";

const setup = (usesAcpProtocol = true) => {
  const conversationList = ref<OpenChatConversation[]>([]);
  const currentConversationKey = ref("c1");
  const activeAgentId = ref("claude");
  const acpRunState = ref<AcpRunStateNotice | null>({ state: "running" });
  const runs = useActiveSessionRuns({
    conversationList,
    currentConversationKey,
    activeAgentId,
    usesAcpProtocol: computed(() => usesAcpProtocol),
    acpRunState,
  });
  return { acpRunState, currentConversationKey, ...runs };
};

describe("settleAcpRunState", () => {
  it("当前 ACP 会话的回合收尾后清除运行标记", () => {
    const { acpRunState, settleAcpRunState } = setup();

    settleAcpRunState("c1");

    expect(acpRunState.value).toBeNull();
  });

  it("后台会话收尾不清除当前会话的运行标记", () => {
    const { acpRunState, settleAcpRunState } = setup();

    settleAcpRunState("background");

    expect(acpRunState.value).toEqual({ state: "running" });
  });

  it("非 ACP 会话不触碰运行标记", () => {
    const { acpRunState, settleAcpRunState } = setup(false);

    settleAcpRunState("c1");

    expect(acpRunState.value).toEqual({ state: "running" });
  });
});

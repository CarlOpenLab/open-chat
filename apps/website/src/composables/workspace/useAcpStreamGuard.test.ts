/// <reference types="vite-plus/test/globals" />

import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import {
  collectStreamingAssistantMessages,
  mergeStreamSnapshotWithLocal,
} from "./useAcpHistoryMerge";

const userBubble = (id: string, content: string): DefaultMessageInfo<XModelMessage> => ({
  id,
  status: "success",
  message: { id, role: "user", content } as XModelMessage,
});

const assistantBubble = (
  id: string,
  content: string,
  status: DefaultMessageInfo<XModelMessage>["status"],
): DefaultMessageInfo<XModelMessage> => ({
  id,
  status,
  message: { id, role: "assistant", content } as XModelMessage,
});

/** 回合进行中：activeSessionRuns 里有该 key。 */
const running = (key: string) => (candidate: string) => candidate === key;
const idle = () => false;

describe("ACP stream guard fix", () => {
  describe("collectStreamingAssistantMessages", () => {
    it("activeSessionRuns 存在时仍收集流式气泡（副路径流不被阻塞）", () => {
      const messages = [
        userBubble("u1", "创建 note"),
        assistantBubble("a-done", "已完成的历史回复", "success"),
        assistantBubble("a-live", "", "loading"),
        assistantBubble("a-updating", "流式片段", "updating"),
      ];

      // 修复前：activeSessionRuns.has(key) 为 true 时 startAcpLiveStream 被阻塞，
      // 副路径流无法订阅，流式内容无法到达客户端。
      // 修复后：即使 activeSessionRuns 存在，collectStreamingAssistantMessages
      // 仍能正确收集流式气泡，确保 mergeStreamSnapshotWithLocal 能保留它们。
      const streaming = collectStreamingAssistantMessages(messages, running("c1"), "c1");

      expect(streaming.map((item) => item.id)).toEqual(["a-live", "a-updating"]);
    });
  });

  describe("mergeStreamSnapshotWithLocal", () => {
    const staleSnapshot = [userBubble("u1", "写入 f.txt")];
    const liveBubble = assistantBubble("msg-1-abc", "已执行：1次命令", "updating");

    it("activeSessionRuns 存在时快照不抹掉流式气泡", () => {
      const local = [userBubble("u1", "写入 f.txt"), { ...liveBubble }];

      // 修复前：副路径流被阻塞，快照到达时本地没有流式气泡可保留。
      // 修复后：副路径流正常工作，快照到达时本地有流式气泡可保留。
      const merged = mergeStreamSnapshotWithLocal(staleSnapshot, local, running("c1"), "c1");

      expect(merged.map((item) => item.id)).toEqual(["u1", "msg-1-abc"]);
      expect(merged[1].status).toBe("updating");
      expect(merged[1].message.content).toBe("已执行：1次命令");
    });

    it("会话未运行时整表采用快照（无回归）", () => {
      const local = [userBubble("u1", "写入 f.txt"), liveBubble];

      const merged = mergeStreamSnapshotWithLocal(staleSnapshot, local, idle, "c1");

      expect(merged).toBe(staleSnapshot);
    });
  });
});

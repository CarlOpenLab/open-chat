/// <reference types="vite-plus/test/globals" />

import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import {
  collectStreamingAssistantMessages,
  mergeStreamSnapshotWithLocal,
  mergeStreamingWithHistory,
  shouldReplaceHistoryWithServer,
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

describe("collectStreamingAssistantMessages", () => {
  it("回合进行中只取仍在累积的 assistant 气泡", () => {
    const messages = [
      userBubble("u1", "创建 note"),
      assistantBubble("a-done", "已完成的历史回复", "success"),
      assistantBubble("a-live", "", "loading"),
      assistantBubble("a-updating", "流式片段", "updating"),
    ];

    const streaming = collectStreamingAssistantMessages(messages, running("c1"), "c1");

    expect(streaming.map((item) => item.id)).toEqual(["a-live", "a-updating"]);
  });

  it("会话没有进行中的回合时返回空（刷新应当整表采用服务端历史）", () => {
    const messages = [assistantBubble("a-live", "", "loading")];

    expect(collectStreamingAssistantMessages(messages, idle, "c1")).toEqual([]);
    expect(collectStreamingAssistantMessages(messages, running("other"), "c1")).toEqual([]);
  });

  it("空 key 或空消息不产生流式气泡", () => {
    expect(collectStreamingAssistantMessages([], running("c1"), "c1")).toEqual([]);
    expect(collectStreamingAssistantMessages([], running("c1"), "")).toEqual([]);
  });
});

describe("mergeStreamingWithHistory", () => {
  it("流式气泡追加在服务端历史之后（回合中服务端尚无本轮输出）", () => {
    const history = [userBubble("u1", "创建 note")];
    const streaming = [
      {
        ...assistantBubble("msg-1-abc", "", "updating"),
        message: { role: "assistant", content: "", fragments: [] } as XModelMessage,
      },
    ];

    const merged = mergeStreamingWithHistory(streaming, history);

    expect(merged.map((item) => item.id)).toEqual(["u1", "msg-1-abc"]);
    // 历史条目保持原引用，不做无谓拷贝。
    expect(merged[0]).toBe(history[0]);
  });

  it("服务端已有同 id 条目时按流式结果覆盖（reload 重发同一条消息）", () => {
    const history = [userBubble("u1", "重问一次"), assistantBubble("a1", "旧内容", "success")];
    const streaming = [assistantBubble("a1", "重新生成的流式内容", "updating")];

    const merged = mergeStreamingWithHistory(streaming, history);

    expect(merged).toHaveLength(2);
    expect(merged[1].message.content).toBe("重新生成的流式内容");
    expect(merged[1].status).toBe("updating");
  });

  it("服务端历史包含更多已完成回合时，流式气泡仍排在最后", () => {
    const history = [userBubble("u1", "第一问"), assistantBubble("a1", "第一答", "success")];
    const streaming = [assistantBubble("msg-2-xyz", "本轮输出", "updating")];

    const merged = mergeStreamingWithHistory(streaming, history);

    expect(merged.map((item) => item.id)).toEqual(["u1", "a1", "msg-2-xyz"]);
    // 保证 loading/updating 状态被保留，列尾「工作中」指示才有挂载点。
    expect(merged[2].status).toBe("updating");
  });
});

describe("mergeStreamSnapshotWithLocal", () => {
  // native 流的快照在回合开始时抓取（历史 + 用户消息），不含本轮 assistant 输出。
  const staleSnapshot = [userBubble("u1", "写入 f.txt")];
  const liveBubble = assistantBubble("msg-1-abc", "已执行：1次命令", "updating");

  it("回合进行中：把本地流式气泡拼回快照，而不是被快照抹掉", () => {
    const local = [userBubble("u1", "写入 f.txt"), { ...liveBubble }];

    const merged = mergeStreamSnapshotWithLocal(staleSnapshot, local, running("c1"), "c1");

    expect(merged.map((item) => item.id)).toEqual(["u1", "msg-1-abc"]);
    // 状态必须保留，列尾「工作中」指示才有挂载点。
    expect(merged[1].status).toBe("updating");
    expect(merged[1].message.content).toBe("已执行：1次命令");
  });

  it("回合已结束（无 loading/updating 气泡）：整表采用快照", () => {
    const local = [userBubble("u1", "写入 f.txt"), assistantBubble("a1", "已写入。", "success")];

    const merged = mergeStreamSnapshotWithLocal(staleSnapshot, local, running("c1"), "c1");

    expect(merged).toBe(staleSnapshot);
  });

  it("会话未运行：整表采用快照", () => {
    const local = [userBubble("u1", "写入 f.txt"), liveBubble];

    const merged = mergeStreamSnapshotWithLocal(staleSnapshot, local, idle, "c1");

    expect(merged).toBe(staleSnapshot);
  });

  it("切换到了别的会话：不把该会话的气泡拼进来", () => {
    const local = [userBubble("u1", "写入 f.txt"), liveBubble];

    const merged = mergeStreamSnapshotWithLocal(staleSnapshot, local, running("other"), "c1");

    expect(merged).toBe(staleSnapshot);
  });

  it("快照为空（native 流尚未落历史）时仍保留本地流式气泡", () => {
    const local = [userBubble("u1", "写入 f.txt"), liveBubble];

    const merged = mergeStreamSnapshotWithLocal([], local, running("c1"), "c1");

    expect(merged.map((item) => item.id)).toEqual(["msg-1-abc"]);
    expect(merged[0].status).toBe("updating");
  });
});

/** 带 chatError 的错误消息：本地错误标记的载体。 */
const erroredAssistant = (id: string): DefaultMessageInfo<XModelMessage> => ({
  id,
  status: "error",
  message: { id, role: "assistant", content: "请求失败" } as XModelMessage & {
    chatError?: string;
  },
});
const withChatError = (msg: DefaultMessageInfo<XModelMessage>) =>
  ({
    ...msg,
    message: { ...msg.message, chatError: "请求失败" } as XModelMessage,
  }) as DefaultMessageInfo<XModelMessage>;

describe("shouldReplaceHistoryWithServer", () => {
  const local = [userBubble("u1", "问"), assistantBubble("a1", "答", "success")];
  const clean = [userBubble("s1", "问"), assistantBubble("s2", "答", "success")];
  const errored = [userBubble("s1", "问"), withChatError(erroredAssistant("s2"))];

  it("本地无错误：采用服务端历史", () => {
    expect(
      shouldReplaceHistoryWithServer({
        localMessages: local,
        serverMessages: clean,
        hasLocalError: false,
        hasServerError: false,
      }),
    ).toBe(true);
  });

  it("本地有错误且服务端也有：错误已同步，采用服务端历史", () => {
    expect(
      shouldReplaceHistoryWithServer({
        localMessages: local,
        serverMessages: errored,
        hasLocalError: true,
        hasServerError: true,
      }),
    ).toBe(true);
  });

  it("本地有错误、服务端干净、本地为空：采用服务端历史", () => {
    expect(
      shouldReplaceHistoryWithServer({
        localMessages: [],
        serverMessages: clean,
        hasLocalError: true,
        hasServerError: false,
      }),
    ).toBe(true);
  });

  it("本地有错误、服务端干净、本地有内容：保留本地，不用干净历史覆盖错误提示", () => {
    expect(
      shouldReplaceHistoryWithServer({
        localMessages: local,
        serverMessages: clean,
        hasLocalError: true,
        hasServerError: false,
      }),
    ).toBe(false);
  });
});

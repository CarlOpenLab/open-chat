/// <reference types="vite-plus/test/globals" />

import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import type { TranscriptMessage } from "@cc-heart/open-chat-types";
import { modelMessagesToBubbleItems } from "./transcript";

/** 构造一条携带 fragments 的 assistant 模型消息。 */
function assistantModelMessage(
  id: string,
  fragments: TranscriptMessage[],
): DefaultMessageInfo<XModelMessage> {
  return {
    id,
    status: "success",
    message: {
      id,
      role: "assistant",
      content: fragments
        .filter((fragment) => fragment.role === "content")
        .map((fragment) => fragment.content)
        .join("\n\n"),
      fragments,
    } as XModelMessage & { fragments: TranscriptMessage[] },
  };
}

describe("modelMessagesToBubbleItems 片段折叠", () => {
  it("单条正文片段在超过折叠阈值时不丢失（长回合末尾的总结正文）", () => {
    // 复现真实 omp 长回合：81 次工具 + 47 段思考 + 1 条计划 + 唯一 1 段正文。
    const fragments: TranscriptMessage[] = [];
    for (let i = 0; i < 47; i += 1) {
      fragments.push({ id: `r${i}`, timestamp: i, role: "reasoning", content: `思考 ${i}` });
    }
    for (let i = 0; i < 81; i += 1) {
      fragments.push({
        id: `t${i}`,
        timestamp: i,
        role: "tool",
        name: "bash",
        status: "completed",
      });
    }
    fragments.push({
      id: "plan",
      timestamp: 1,
      role: "plan",
      entries: Array.from({ length: 11 }, (_, i) => ({
        content: `步骤 ${i}`,
        status: "completed" as const,
      })),
    });
    fragments.push({
      id: "c1",
      timestamp: 2,
      role: "content",
      content: "📋 同步 PR 汇总表（正文）",
    });

    const items = modelMessagesToBubbleItems([assistantModelMessage("msg1", fragments)]);
    const contentBubble = items.find((item) => item.extraInfo?.messageRole === "content");
    expect(contentBubble).toBeDefined();
    expect(String(contentBubble?.content ?? "")).toContain("同步 PR 汇总表");
    // 思考折叠为单条活动项后也不丢（长回合常只有一段思考）。
    const reasoningItem = items.find((item) => item.extraInfo?.messageRole === "activities");
    expect(reasoningItem).toBeDefined();
    // 工具活动逐条保留，供「已执行：N 次命令」摘要统计。
    expect(items.filter((item) => item.extraInfo?.messageRole === "tool")).toHaveLength(81);
  });

  it("不超过阈值时正文气泡照常平铺", () => {
    const fragments: TranscriptMessage[] = [
      { id: "c1", timestamp: 1, role: "content", content: "你好" },
    ];
    const items = modelMessagesToBubbleItems([assistantModelMessage("msg2", fragments)]);
    expect(items).toHaveLength(1);
    expect(items[0].extraInfo?.messageRole).toBe("content");
    expect(items[0].content).toBe("你好");
  });
});

/// <reference types="vite-plus/test/globals" />

import type { BubbleItemType } from "@antdv-next/x";
import { buildMessageScrollerItems, messageRailAnchorId } from "./messageScrollerRail";

const item = (overrides: Partial<BubbleItemType>): BubbleItemType =>
  ({
    key: "k",
    role: "assistant",
    status: "success",
    loading: false,
    content: "",
    ...overrides,
  }) as BubbleItemType;

describe("buildMessageScrollerItems", () => {
  it("导轨只保留用户消息，执行过程与助手正文不作为刻度", () => {
    const items = buildMessageScrollerItems([
      item({ key: "u1", role: "user", content: "第一问" }),
      item({
        key: "a1",
        role: "assistant",
        content: "回答",
        extraInfo: { messageRole: "content" },
      }),
      item({ key: "act1", role: "assistant", extraInfo: { messageRole: "activities" } }),
      item({ key: "u2", role: "user", content: "第二问" }),
    ]);

    expect(items).toEqual([
      { id: "u1", title: "你", description: "第一问" },
      { id: "u2", title: "你", description: "第二问" },
    ]);
  });

  it("描述压缩空白，内容为空时回退为省略号", () => {
    const items = buildMessageScrollerItems([
      item({ key: "u1", role: "user", content: " 多\n行\t 内容 " }),
      item({ key: "u2", role: "user", content: "   " }),
    ]);

    expect(items.map((entry) => entry.description)).toEqual(["多 行 内容", "…"]);
  });

  it("没有用户消息时导轨为空", () => {
    expect(buildMessageScrollerItems([item({ role: "assistant", content: "只有回答" })])).toEqual(
      [],
    );
  });
});

describe("messageRailAnchorId", () => {
  it("只有用户消息行是导轨锚点", () => {
    expect(messageRailAnchorId(item({ key: "u1", role: "user" }))).toBe("u1");
    expect(messageRailAnchorId(item({ key: "a1", role: "assistant" }))).toBeUndefined();
    expect(
      messageRailAnchorId(
        item({ key: "act1", role: "assistant", extraInfo: { messageRole: "activities" } }),
      ),
    ).toBeUndefined();
  });
});

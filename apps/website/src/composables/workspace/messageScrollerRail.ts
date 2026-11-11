import type { BubbleItemType } from "@antdv-next/x";
import type { MessageScrollerItem } from "@antdv-next/x-pro";

/**
 * 用户消息行的导轨锚点；其余行不挂 `data-message-id`。
 *
 * MessageScroller 的导轨刻度来自 `itemSelector` 匹配到的 DOM 节点，而不是
 * `items` 元数据。只给用户行加锚点，执行过程与助手正文才不会占满右侧导轨。
 */
export function messageRailAnchorId(item: BubbleItemType): string | undefined {
  return item.role === "user" ? String(item.key) : undefined;
}

/**
 * 消息导航导轨的刻度：只标注用户自己发送的消息。
 *
 * 执行过程（思考 / 工具 / 计划）与助手正文不进入导轨——它们数量多、更新频繁，
 * 会把真正由用户发起的对话节点淹没。id 必须与消息行的 data-message-id 一致。
 */
export function buildMessageScrollerItems(items: BubbleItemType[]): MessageScrollerItem[] {
  return items
    .filter((item) => item.role === "user")
    .map((item) => ({
      id: String(item.key),
      title: "你",
      description:
        String(item.content ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80) || "…",
    }));
}

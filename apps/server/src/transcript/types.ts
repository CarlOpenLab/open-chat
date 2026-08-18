/**
 * 服务端 transcript canonical 类型：全部来自共享包 @cc-heart/open-chat-types。
 * 扁平模型：assistant 消息只有 segments，正文由前端合并 content 段得出。
 */
export * from "@cc-heart/open-chat-types";

import type { TranscriptMessage, TranscriptRole } from "@cc-heart/open-chat-types";

export interface TranscriptHistoryCollector {
  messages: TranscriptMessage[];
  nextId: number;
  activeRole: TranscriptRole | null;
}

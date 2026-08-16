import type { ServerResponse } from "node:http";
import type { TranscriptActivity, TranscriptPlan } from "./transcript/types";

/** Events emitted by a CLI turn after the provider wire format is decoded. */
export type NativeCliEvent =
  | { type: "content.delta"; content: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "activity.upsert"; activity: TranscriptActivity }
  | { type: "plan.updated"; plan: TranscriptPlan }
  | { type: "turn.completed"; stopReason?: string }
  | { type: "turn.failed"; message: string };

/**
 * Keep the native event stream separate from the OpenAI compatibility stream.
 * The gateway forwards these frames; it does not accumulate a transcript or
 * rebuild an assistant message from them.
 */
export function writeNativeEvent(res: ServerResponse, event: NativeCliEvent): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(nativeEventFrame(event));
  } catch {
    // The client may close the stream between the state check and the write.
  }
}

export function nativeEventFrame(event: NativeCliEvent): string {
  return `event: native_event\ndata: ${JSON.stringify(event)}\n\n`;
}

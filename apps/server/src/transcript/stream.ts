import type { ServerResponse } from "node:http";
import type { TranscriptStreamEvent } from "./types";

export interface TranscriptChunkOptions {
  id?: string;
  finishReason?: string | null;
}

export function createTranscriptChunk(
  model: string,
  delta: Record<string, unknown>,
  options: TranscriptChunkOptions = {},
) {
  return {
    id: options.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: options.finishReason ?? null }],
  };
}

export function writeTranscriptChunk(
  res: ServerResponse,
  model: string,
  delta: Record<string, unknown>,
  options: TranscriptChunkOptions = {},
): void {
  if (res.writableEnded || res.destroyed) return;
  writeTranscriptData(res, createTranscriptChunk(model, delta, options));
}

export function writeTranscriptData(res: ServerResponse, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // The client closed the response between the state check and the write.
  }
}

export function writeTranscriptCustomEvent(
  res: ServerResponse,
  event: string,
  data: unknown,
): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // The client closed the response between the state check and the write.
  }
}

/** Serialize the canonical event model to the existing web-client wire protocol. */
export function writeTranscriptStreamEvent(
  res: ServerResponse,
  model: string,
  event: TranscriptStreamEvent,
): void {
  switch (event.type) {
    case "message.append":
      writeTranscriptCustomEvent(res, "transcript_message", event.message);
      break;
    case "content.delta":
      writeTranscriptChunk(res, model, { content: event.content });
      break;
    case "reasoning.delta":
      writeTranscriptChunk(res, model, { reasoning_content: event.content });
      break;
    case "activity.upsert":
      writeTranscriptCustomEvent(res, "tool_call", event.activity);
      break;
    case "plan.updated":
      writeTranscriptCustomEvent(res, "acp_plan", event.plan);
      break;
    case "turn.completed":
      writeTranscriptChunk(res, model, {}, { finishReason: event.stopReason ?? "stop" });
      break;
    case "turn.failed":
      writeTranscriptCustomEvent(res, "chat_error", { message: event.message });
      break;
  }
}

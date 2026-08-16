import type { ServerResponse } from "node:http";
import { nativeEventFrame } from "./nativeEvents";
import type { TranscriptMessage } from "./transcript/types";

export interface SessionRunView {
  agentId: string;
  conversationId: string;
  sessionId: string;
  projectPath?: string;
  createdAt: number;
  startedAt: number;
  lastUsed: number;
  running: true;
}

interface SessionRunEntry extends SessionRunView {
  abort: AbortController;
  response: ServerResponse;
  snapshot: TranscriptMessage[];
  chunks: string[];
  bufferedBytes: number;
  parserBuffer: string;
  subscribers: Set<ServerResponse>;
  doneSeen: boolean;
}

const RUN_BUFFER_LIMIT_BYTES = 16 * 1024 * 1024;

const runKey = (agentId: string, conversationId: string): string => `${agentId}:${conversationId}`;

const chunkText = (chunk: unknown): string => {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return "";
};

export class SessionRunRegistry {
  private readonly runs = new Map<string, SessionRunEntry>();

  list(agentId?: string): SessionRunView[] {
    return [...this.runs.values()]
      .filter((run) => !agentId || run.agentId === agentId)
      .map(
        ({
          abort: _abort,
          response: _response,
          snapshot: _snapshot,
          chunks: _chunks,
          subscribers: _subscribers,
          bufferedBytes: _bufferedBytes,
          parserBuffer: _parserBuffer,
          doneSeen: _doneSeen,
          ...view
        }) => view,
      )
      .sort((left, right) => right.lastUsed - left.lastUsed);
  }

  start(options: {
    agentId: string;
    conversationId: string;
    sessionId?: string;
    projectPath?: string;
    snapshot: TranscriptMessage[];
    response: ServerResponse;
  }): { response: ServerResponse; signal: AbortSignal } {
    const key = runKey(options.agentId, options.conversationId);
    if (this.runs.has(key)) throw new Error("该会话仍在运行，请先停止当前任务");

    const now = Date.now();
    const entry: SessionRunEntry = {
      agentId: options.agentId,
      conversationId: options.conversationId,
      sessionId: options.sessionId?.trim() || options.conversationId,
      ...(options.projectPath ? { projectPath: options.projectPath } : {}),
      createdAt: now,
      startedAt: now,
      lastUsed: now,
      running: true,
      abort: new AbortController(),
      response: options.response,
      snapshot: options.snapshot,
      chunks: [],
      bufferedBytes: 0,
      parserBuffer: "",
      subscribers: new Set(),
      doneSeen: false,
    };
    this.runs.set(key, entry);
    return {
      response: this.mirrorResponse(entry),
      signal: entry.abort.signal,
    };
  }

  subscribe(agentId: string, conversationId: string, response: ServerResponse): boolean {
    const entry = this.runs.get(runKey(agentId, conversationId));
    if (!entry) return false;

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`event: snapshot\ndata: ${JSON.stringify({ messages: entry.snapshot })}\n\n`);
    for (const chunk of entry.chunks) response.write(chunk);
    entry.subscribers.add(response);
    response.on("close", () => entry.subscribers.delete(response));
    return true;
  }

  cancel(agentId: string, conversationId: string): boolean {
    const entry = this.runs.get(runKey(agentId, conversationId));
    if (!entry) return false;
    entry.abort.abort();
    return true;
  }

  finish(agentId: string, conversationId: string, error?: unknown): void {
    const key = runKey(agentId, conversationId);
    const entry = this.runs.get(key);
    if (!entry) return;

    if (error && !entry.doneSeen) {
      const message = error instanceof Error ? error.message : "任务异常";
      const frame = nativeEventFrame({ type: "turn.failed", message });
      this.publish(entry, frame);
      if (!entry.response.writableEnded && !entry.response.destroyed) entry.response.write(frame);
    }
    if (!entry.doneSeen) {
      this.publish(entry, "data: [DONE]\n\n");
      if (!entry.response.writableEnded && !entry.response.destroyed) {
        entry.response.write("data: [DONE]\n\n");
      }
    }
    if (!entry.response.writableEnded && !entry.response.destroyed) entry.response.end();
    for (const subscriber of entry.subscribers) {
      if (!subscriber.writableEnded && !subscriber.destroyed) subscriber.end();
    }
    entry.subscribers.clear();
    this.runs.delete(key);
  }

  stop(): void {
    for (const entry of this.runs.values()) entry.abort.abort();
    for (const entry of this.runs.values()) {
      for (const subscriber of entry.subscribers) {
        if (!subscriber.writableEnded && !subscriber.destroyed) subscriber.end();
      }
    }
    this.runs.clear();
  }

  private mirrorResponse(entry: SessionRunEntry): ServerResponse {
    return new Proxy({} as ServerResponse, {
      get: (_target, property) => {
        if (property === "write") {
          return (chunk: string | Uint8Array) => {
            this.publish(entry, chunkText(chunk));
            if (entry.response.writableEnded || entry.response.destroyed) return true;
            return entry.response.write(chunk);
          };
        }
        if (property === "end") {
          return (chunk?: string | Uint8Array) => {
            if (chunk != null) this.publish(entry, chunkText(chunk));
            if (entry.response.writableEnded || entry.response.destroyed) return entry.response;
            return entry.response.end(chunk);
          };
        }
        const value = Reflect.get(entry.response, property, entry.response) as unknown;
        return typeof value === "function" ? value.bind(entry.response) : value;
      },
    });
  }

  private publish(entry: SessionRunEntry, chunk: string): void {
    if (!chunk) return;
    entry.lastUsed = Date.now();
    entry.chunks.push(chunk);
    entry.bufferedBytes += Buffer.byteLength(chunk);
    while (entry.bufferedBytes > RUN_BUFFER_LIMIT_BYTES && entry.chunks.length > 1) {
      const removed = entry.chunks.shift();
      if (removed) entry.bufferedBytes -= Buffer.byteLength(removed);
    }
    for (const subscriber of entry.subscribers) {
      if (!subscriber.writableEnded && !subscriber.destroyed) subscriber.write(chunk);
    }
    this.inspectFrames(entry, chunk);
  }

  private inspectFrames(entry: SessionRunEntry, chunk: string): void {
    entry.parserBuffer += chunk.replace(/\r\n/g, "\n");
    let separator = entry.parserBuffer.indexOf("\n\n");
    while (separator !== -1) {
      const frame = entry.parserBuffer.slice(0, separator);
      entry.parserBuffer = entry.parserBuffer.slice(separator + 2);
      const event = frame
        .split("\n")
        .find((line) => line.startsWith("event:"))
        ?.slice("event:".length)
        .trim();
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      if (data === "[DONE]") entry.doneSeen = true;
      if (event === "provider_session" && data) {
        try {
          const notice = JSON.parse(data) as { sessionId?: unknown };
          if (typeof notice.sessionId === "string" && notice.sessionId.trim()) {
            entry.sessionId = notice.sessionId.trim();
          }
        } catch {
          // Ignore an isolated malformed metadata frame; the stream remains usable.
        }
      }
      separator = entry.parserBuffer.indexOf("\n\n");
    }
  }
}

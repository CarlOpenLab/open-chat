import type { ServerResponse } from "node:http";

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

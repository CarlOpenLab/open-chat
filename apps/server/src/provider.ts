/**
 * OpenAI-compatible chat completions client.
 *
 * Mirrors `rust-chat/src/providers/openai_compatible.rs`: forwards the request
 * body (model + messages + stream + any extra OpenAI fields) to the upstream
 * provider and returns either the parsed JSON or a byte stream for SSE.
 */
import { GatewayError } from "./error";

export interface ChatCompletionRequest {
  model?: string;
  messages: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

const CHAT_COMPLETIONS_PATH = "chat/completions";

export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${CHAT_COMPLETIONS_PATH}`;
}

export class OpenAiCompatibleProvider {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;

  constructor(name: string, baseUrl: string, apiKey: string) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  chatCompletionsUrl(): string {
    return chatCompletionsUrl(this.baseUrl);
  }

  /**
   * Build the upstream request body. `model`, `messages`, and `stream` are
   * controlled by the gateway; everything else (temperature, tools, ...) is
   * passed through. `provider` is gateway routing metadata and is stripped.
   */
  buildBody(
    request: ChatCompletionRequest,
    model: string,
    stream: boolean,
  ): Record<string, unknown> {
    const {
      model: _model,
      messages: _messages,
      stream: _stream,
      provider: _provider,
      ...extra
    } = request;
    return {
      ...extra,
      model,
      messages: request.messages,
      stream,
    };
  }

  async chat(request: ChatCompletionRequest, model: string): Promise<unknown> {
    const body = this.buildBody(request, model, false);
    const response = await fetch(this.chatCompletionsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw GatewayError.upstream(
        `${this.name} request failed with status ${response.status}: ${text}`,
      );
    }

    try {
      return JSON.parse(text);
    } catch (err) {
      throw GatewayError.upstream(`Invalid ${this.name} response JSON: ${(err as Error).message}`);
    }
  }

  async chatStream(
    request: ChatCompletionRequest,
    model: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const body = this.buildBody(request, model, true);
    const response = await fetch(this.chatCompletionsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw GatewayError.upstream(
        `${this.name} stream request failed with status ${response.status}: ${text}`,
      );
    }

    if (!response.body) {
      throw GatewayError.upstream(`No response body from ${this.name} stream`);
    }

    return response.body;
  }
}

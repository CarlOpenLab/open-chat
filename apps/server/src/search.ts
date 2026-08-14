/**
 * Web search integration for the gateway.
 *
 * Search is exposed to the model as a function-calling tool (`web_search`). The
 * agent loop in `search-agent.ts` decides when to invoke it, runs the query
 * against the configured provider (Tavily) and feeds the results back to the
 * model. API keys stay server-side; the frontend only ever sees public web
 * results (delivered via a custom SSE event for the `Sources` UI).
 */
import type { SearchConfig } from "./config";
import { GatewayError } from "./error";

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string): Promise<{ answer?: string; results: WebSearchResult[] }>;
}

/**
 * 解析 `$ENV_VAR` / `${ENV_VAR}` 引用（pi 风格）；其余按字面使用。
 * 引用缺失时抛错（服务端配置错误应显式暴露）。
 */
function resolveApiKey(value: string): string {
  if (value === undefined || value === null) return "";
  const match = value.trim().match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (match) {
    const resolved = process.env[match[1]];
    if (!resolved) {
      throw GatewayError.invalidRequest(
        `API key references ${match[1]}, but it is not set in the server environment`,
      );
    }
    return resolved;
  }
  const direct = value.trim().match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
  if (direct) {
    const resolved = process.env[direct[1]];
    if (!resolved) {
      throw GatewayError.invalidRequest(
        `API key references ${direct[1]}, but it is not set in the server environment`,
      );
    }
    return resolved;
  }
  return value;
}

/** Build a search provider from config, or return null when search is disabled. */
export function createSearchProvider(config: SearchConfig): SearchProvider | null {
  const provider = config.provider.trim().toLowerCase();
  if (!provider || provider === "disabled" || provider === "off") return null;
  // 与存储的服务商 key 一致：支持 `$ENV_VAR` / `${ENV_VAR}` 引用，
  // 密钥不必写进 TOML 明文；引用缺失时启动即报错（配置错误应显式暴露）。
  const apiKey = resolveApiKey(config.apiKey);
  if (!apiKey.trim()) {
    throw GatewayError.invalidRequest(
      `search.api_key is required when search.provider is "${config.provider}"`,
    );
  }
  if (provider === "tavily") return new TavilySearchProvider({ ...config, apiKey });
  throw GatewayError.invalidRequest(`Unsupported search provider: ${config.provider}`);
}

class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";
  private readonly apiKey: string;
  private readonly maxResults: number;
  private readonly searchDepth: "basic" | "advanced";
  private readonly includeAnswer: boolean;

  constructor(config: SearchConfig) {
    this.apiKey = config.apiKey;
    this.maxResults = config.maxResults;
    this.searchDepth = config.searchDepth;
    this.includeAnswer = config.includeAnswer;
  }

  async search(query: string): Promise<{ answer?: string; results: WebSearchResult[] }> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: this.searchDepth,
        include_answer: this.includeAnswer,
        max_results: this.maxResults,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw GatewayError.upstream(`Tavily search failed with status ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      answer?: string;
      results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
    };

    const results: WebSearchResult[] = (data.results ?? []).map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      content: item.content ?? "",
      ...(typeof item.score === "number" ? { score: item.score } : {}),
    }));

    return {
      ...(typeof data.answer === "string" && data.answer ? { answer: data.answer } : {}),
      results,
    };
  }
}

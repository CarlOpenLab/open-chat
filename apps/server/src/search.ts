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

/** Build a search provider from config, or return null when search is disabled. */
export function createSearchProvider(config: SearchConfig): SearchProvider | null {
  const provider = config.provider.trim().toLowerCase();
  if (!provider || provider === "disabled" || provider === "off") return null;
  if (!config.apiKey.trim()) {
    throw GatewayError.invalidRequest(
      `search.api_key is required when search.provider is "${config.provider}"`,
    );
  }
  if (provider === "tavily") return new TavilySearchProvider(config);
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

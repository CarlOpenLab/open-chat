/**
 * Provider configuration parsed from a TOML file.
 *
 * Mirrors the schema and validation of `rust-chat/src/config.rs` so the same
 * `providers.example.toml` can be consumed by either gateway.
 *
 * Deviation from rust-chat: `gateway_api_key` is optional here. When omitted or
 * empty, bearer-token authentication is disabled (handy for local development).
 */
import { readFileSync } from "node:fs";
import { parse, TomlError } from "smol-toml";
import { GatewayError } from "./error";

export interface ModelConfig {
  id: string;
  name?: string;
  contextLength?: number;
}

export type ProviderApi = "chat/completions" | "responses";

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  api: ProviderApi;
  models: ModelConfig[];
}

export interface SearchConfig {
  /** Empty or "disabled" turns web search off. Currently supports "tavily". */
  provider: string;
  apiKey: string;
  maxResults: number;
  searchDepth: "basic" | "advanced";
  includeAnswer: boolean;
}

export interface AppConfig {
  /** Empty string when authentication is disabled. */
  gatewayApiKey: string;
  bindAddr: string;
  defaultModel: string;
  corsAllowedOrigins: string[];
  providers: ProviderConfig[];
  search: SearchConfig;
}

interface RawModelConfig {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
}

interface RawProviderConfig {
  name?: unknown;
  base_url?: unknown;
  api_key?: unknown;
  api?: unknown;
  models?: unknown;
}

interface RawSearchConfig {
  provider?: unknown;
  api_key?: unknown;
  max_results?: unknown;
  search_depth?: unknown;
  include_answer?: unknown;
}

interface RawGatewayConfig {
  gateway_api_key?: unknown;
  bind_addr?: unknown;
  default_model?: unknown;
  cors_allowed_origins?: unknown;
  providers?: unknown;
  search?: unknown;
}

const DEFAULT_BIND_ADDR = "127.0.0.1:8082";

export function loadConfigFile(path: string): AppConfig {
  let tomlStr: string;
  try {
    tomlStr = readFileSync(path, "utf8");
  } catch (err) {
    throw GatewayError.invalidRequest(
      `Failed to read config file ${path}: ${(err as Error).message}`,
    );
  }
  return parseConfig(tomlStr);
}

export function parseConfig(tomlStr: string): AppConfig {
  let raw: RawGatewayConfig;
  try {
    raw = parse(tomlStr) as RawGatewayConfig;
  } catch (err) {
    if (err instanceof TomlError) {
      throw GatewayError.invalidRequest(`Invalid provider config TOML: ${err.message}`);
    }
    throw err;
  }

  const providers = parseProviders(raw.providers);
  const search = parseSearch(raw.search);
  const gatewayApiKey = optionalString(raw.gateway_api_key) ?? "";
  const defaultModel = optionalString(raw.default_model) ?? providers[0].models[0].id;
  const bindAddr = optionalString(raw.bind_addr) ?? DEFAULT_BIND_ADDR;
  const corsAllowedOrigins = parseStringArray(raw.cors_allowed_origins, "cors_allowed_origins");

  return {
    gatewayApiKey,
    bindAddr,
    defaultModel,
    corsAllowedOrigins,
    providers,
    search,
  };
}

export function parseBindAddr(addr: string): { host: string; port: number } {
  const match = addr.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
  if (!match) {
    throw GatewayError.invalidRequest(`Invalid bind_addr (expected host:port): ${addr}`);
  }
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw GatewayError.invalidRequest(`Invalid bind_addr port: ${addr}`);
  }
  return { host: match[1], port };
}

function parseProviders(rawProviders: unknown): ProviderConfig[] {
  if (!Array.isArray(rawProviders)) {
    throw GatewayError.invalidRequest("providers must be an array of [[providers]] tables");
  }
  if (rawProviders.length === 0) {
    throw GatewayError.invalidRequest("provider config must contain at least one provider");
  }
  return rawProviders.map((raw, index) => parseProvider(raw as RawProviderConfig, index));
}

function parseProvider(raw: RawProviderConfig, index: number): ProviderConfig {
  const name = requiredString(raw.name, `providers[${index}].name is required`);
  const baseUrl = requiredString(raw.base_url, `providers[${index}].base_url is required`);
  const apiKey = requiredString(raw.api_key, `providers[${index}].api_key is required`);
  const api = parseProviderApi(raw.api, index);
  const models = parseModels(raw.models, index);
  return { name, baseUrl, apiKey, api, models };
}

function parseProviderApi(value: unknown, providerIndex: number): ProviderApi {
  const api = optionalString(value) ?? "chat/completions";
  if (api === "chat/completions" || api === "responses") return api;
  throw GatewayError.invalidRequest(
    `providers[${providerIndex}].api must be "chat/completions" or "responses"`,
  );
}

function parseModels(rawModels: unknown, providerIndex: number): ModelConfig[] {
  if (!Array.isArray(rawModels)) {
    throw GatewayError.invalidRequest(
      `providers[${providerIndex}].models must be an array of [[providers.models]] tables`,
    );
  }
  if (rawModels.length === 0) {
    throw GatewayError.invalidRequest(`providers[${providerIndex}].models must not be empty`);
  }

  const models: ModelConfig[] = [];
  for (let i = 0; i < rawModels.length; i++) {
    const raw = rawModels[i] as RawModelConfig;
    const id = requiredString(raw.id, `providers[${providerIndex}].models[${i}].id is required`);
    const name = optionalString(raw.name);
    const contextLength = typeof raw.context_length === "number" ? raw.context_length : undefined;

    models.push({
      id,
      ...(name ? { name } : {}),
      ...(contextLength ? { contextLength } : {}),
    });
  }
  return models;
}

function parseSearch(raw: unknown): SearchConfig {
  if (raw === undefined || raw === null) {
    return { provider: "", apiKey: "", maxResults: 5, searchDepth: "basic", includeAnswer: true };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw GatewayError.invalidRequest("[search] must be a table");
  }
  const s = raw as RawSearchConfig;
  const provider = optionalString(s.provider) ?? "";
  const apiKey = optionalString(s.api_key) ?? "";
  const maxResults =
    typeof s.max_results === "number" && Number.isFinite(s.max_results) && s.max_results > 0
      ? Math.floor(s.max_results)
      : 5;
  const depthRaw = optionalString(s.search_depth);
  const searchDepth = depthRaw === "advanced" ? "advanced" : "basic";
  const includeAnswer = typeof s.include_answer === "boolean" ? s.include_answer : true;
  return { provider, apiKey, maxResults, searchDepth, includeAnswer };
}

/** Returns a trimmed non-empty string, or `undefined` when missing/blank. */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredString(value: unknown, message: string): string {
  const result = optionalString(value);
  if (result === undefined) {
    throw GatewayError.invalidRequest(message);
  }
  return result;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw GatewayError.invalidRequest(`${field} must be an array of strings`);
  }
  return value
    .map((item, index) => {
      if (typeof item !== "string") {
        throw GatewayError.invalidRequest(`${field}[${index}] must be a string`);
      }
      return item.trim();
    })
    .filter((item) => item.length > 0);
}

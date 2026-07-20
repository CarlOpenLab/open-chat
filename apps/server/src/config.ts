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

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ModelConfig[];
}

export interface AppConfig {
  /** Empty string when authentication is disabled. */
  gatewayApiKey: string;
  bindAddr: string;
  defaultModel: string;
  corsAllowedOrigins: string[];
  providers: ProviderConfig[];
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
  models?: unknown;
}

interface RawGatewayConfig {
  gateway_api_key?: unknown;
  bind_addr?: unknown;
  default_model?: unknown;
  cors_allowed_origins?: unknown;
  providers?: unknown;
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
  const models = parseModels(raw.models, index);
  return { name, baseUrl, apiKey, models };
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

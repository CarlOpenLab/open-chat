/**
 * Persistent provider store (`config/providers.json`).
 *
 * Mirrors pi's approach of keeping credentials in a local file (`auth.json`)
 * with restrictive permissions: user-added providers live on the server as
 * JSON, and their API keys are encrypted at rest with AES-256-GCM. The
 * encryption key comes from `PROVIDER_ENCRYPTION_KEY` (64 hex chars) or an
 * auto-generated `config/.provider-store-key` file (0600, git-ignored).
 *
 * Like pi's `auth.json`, a stored `apiKey` may reference an environment
 * variable (`$OPENCODE_API_KEY` / `${DEEPSEEK_API_KEY}`) which is resolved at
 * request time, so secrets never have to be typed into the UI.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModelConfig, ProviderApi, ProviderConfig } from "./config";
import { GatewayError } from "./error";

export interface StoredProviderInput {
  name: string;
  baseUrl: string;
  /** Plain-text key (may be `$ENV_VAR`); encrypted before persisting. */
  apiKey: string;
  api: ProviderApi;
  models: ModelConfig[];
}

export interface StoredProvider extends StoredProviderInput {
  id: string;
  /** AES-256-GCM payload: `iv.tag.ciphertext` (base64). */
  apiKeyEncrypted: string;
  createdAt: number;
  updatedAt: number;
}

/** Public shape returned by the API — never contains the key. */
export interface StoredProviderView {
  id: string;
  name: string;
  baseUrl: string;
  api: ProviderApi;
  models: ModelConfig[];
  hasKey: boolean;
  apiKeyMasked: string;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_STORE_PATH = "config/providers.json";
const KEY_FILE_SUFFIX = ".provider-store-key";

interface StoreFile {
  version: 1;
  providers: StoredProvider[];
}

/**
 * Encrypts `plaintext` with AES-256-GCM. Returns `iv.tag.ciphertext` joined by
 * `.`, each part base64-encoded.
 */
function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

/** Decrypts a payload produced by `encrypt`. Throws on tampered data. */
function decrypt(payload: string, key: Buffer): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw GatewayError.invalidRequest("Stored provider key is corrupted");
  }
  const [ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    throw GatewayError.invalidRequest(
      `Failed to decrypt stored provider key: ${(err as Error).message}`,
    );
  }
}

/**
 * Resolves a key reference. Supports pi-style `$ENV_VAR` / `${ENV_VAR}`
 * interpolation against `process.env`; anything else is used literally.
 */
export function resolveApiKey(value: string): string {
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

function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export class ProviderStore {
  private readonly filePath: string;
  private readonly key: Buffer;
  private providers: StoredProvider[] = [];

  constructor(filePath: string = DEFAULT_STORE_PATH) {
    this.filePath = filePath;
    this.key = this.loadEncryptionKey();
    this.load();
  }

  list(): StoredProviderView[] {
    return this.providers.map((provider) => this.toView(provider));
  }

  get(id: string): StoredProviderView | undefined {
    const provider = this.providers.find((item) => item.id === id);
    return provider ? this.toView(provider) : undefined;
  }

  /** Creates a new provider. `apiKey` is required and encrypted at rest. */
  create(input: StoredProviderInput): StoredProviderView {
    const normalized = normalizeInput(input, true);
    this.ensureNoDuplicateModels(normalized);
    const now = Date.now();
    const provider: StoredProvider = {
      id: randomBytes(8).toString("hex"),
      name: normalized.name,
      baseUrl: normalized.baseUrl,
      apiKey: "",
      apiKeyEncrypted: encrypt(normalized.apiKey, this.key),
      api: normalized.api,
      models: normalized.models,
      createdAt: now,
      updatedAt: now,
    };
    this.providers.push(provider);
    this.persist();
    return this.toView(provider);
  }

  /** Updates an existing provider. Empty `apiKey` keeps the stored key. */
  update(id: string, input: StoredProviderInput): StoredProviderView {
    const index = this.providers.findIndex((item) => item.id === id);
    if (index === -1) {
      throw GatewayError.invalidRequest(`Provider not found: ${id}`);
    }
    const normalized = normalizeInput(input, false);
    this.ensureNoDuplicateModels(normalized, id);
    const existing = this.providers[index];
    const updated: StoredProvider = {
      ...existing,
      name: normalized.name,
      baseUrl: normalized.baseUrl,
      api: normalized.api,
      models: normalized.models,
      ...(normalized.apiKey ? { apiKeyEncrypted: encrypt(normalized.apiKey, this.key) } : {}),
      updatedAt: Date.now(),
    };
    this.providers[index] = updated;
    this.persist();
    return this.toView(updated);
  }

  remove(id: string): boolean {
    const before = this.providers.length;
    this.providers = this.providers.filter((item) => item.id !== id);
    if (this.providers.length === before) return false;
    this.persist();
    return true;
  }

  /**
   * Builds gateway-ready provider configs: decrypts stored keys, resolves
   * `$ENV_VAR` references, and drops the plaintext from memory afterwards.
   */
  resolveForGateway(): ProviderConfig[] {
    return this.providers.map((provider) => {
      const apiKey = resolveApiKey(decrypt(provider.apiKeyEncrypted, this.key));
      return {
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey,
        api: provider.api,
        models: provider.models,
      };
    });
  }

  /** True when the store contains at least one provider. */
  get size(): number {
    return this.providers.length;
  }

  private toView(provider: StoredProvider): StoredProviderView {
    let decrypted = "";
    try {
      decrypted = decrypt(provider.apiKeyEncrypted, this.key);
    } catch {
      // Corrupted keys are reported as "not configured" rather than crashing.
    }
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: provider.api,
      models: provider.models,
      hasKey: decrypted.length > 0,
      apiKeyMasked: maskKey(decrypted),
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  }

  /**
   * The AES-256-GCM key. Priority: `PROVIDER_ENCRYPTION_KEY` env var (64 hex
   * chars) → `config/.provider-store-key` → freshly generated file (0600).
   */
  private loadEncryptionKey(): Buffer {
    const fromEnv = process.env.PROVIDER_ENCRYPTION_KEY;
    if (fromEnv) {
      const hex = fromEnv.trim();
      if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error("PROVIDER_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes)");
      }
      return Buffer.from(hex, "hex");
    }
    const keyFile = join(dirname(this.filePath), KEY_FILE_SUFFIX);
    if (existsSync(keyFile)) {
      const hex = readFileSync(keyFile, "utf8").trim();
      if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error(`Invalid encryption key file: ${keyFile}`);
      }
      return Buffer.from(hex, "hex");
    }
    const key = randomBytes(32).toString("hex");
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
    return Buffer.from(key, "hex");
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.providers = [];
      return;
    }
    let parsed: StoreFile;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      if (typeof raw !== "object" || raw === null || !Array.isArray((raw as StoreFile).providers)) {
        throw new Error("expected { version: 1, providers: [] }");
      }
      parsed = raw as StoreFile;
    } catch (err) {
      throw new Error(`Failed to load provider store ${this.filePath}: ${(err as Error).message}`);
    }
    this.providers = parsed.providers;
  }

  private persist(): void {
    const payload: StoreFile = { version: 1, providers: this.providers };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  }

  /** Model ids must be unique across every provider (TOML + stored). */
  private ensureNoDuplicateModels(input: StoredProviderInput, skipId?: string): void {
    const existingIds = new Set<string>();
    for (const provider of this.providers) {
      if (skipId && provider.id === skipId) continue;
      for (const model of provider.models) existingIds.add(model.id);
    }
    const duplicate = input.models.find((model) => existingIds.has(model.id));
    if (duplicate) {
      throw GatewayError.invalidRequest(`Model is configured more than once: ${duplicate.id}`);
    }
  }
}

function normalizeInput(input: StoredProviderInput, requireKey: boolean): StoredProviderInput {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const baseUrl = typeof input?.baseUrl === "string" ? input.baseUrl.replace(/\/+$/, "") : "";
  const apiKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  const api = input?.api === "responses" ? "responses" : "chat/completions";
  const models = Array.isArray(input?.models) ? input.models : [];

  if (!name) throw GatewayError.invalidRequest("Provider name is required");
  if (!baseUrl) throw GatewayError.invalidRequest("Provider baseUrl is required");
  if (requireKey && !apiKey) {
    throw GatewayError.invalidRequest("Provider apiKey is required");
  }
  if (models.length === 0) {
    throw GatewayError.invalidRequest("Provider must declare at least one model");
  }
  const normalizedModels: ModelConfig[] = [];
  for (let i = 0; i < models.length; i++) {
    const raw = models[i];
    const id = typeof raw?.id === "string" ? raw.id.trim() : "";
    if (!id) throw GatewayError.invalidRequest(`providers.models[${i}].id is required`);
    normalizedModels.push({
      id,
      ...(typeof raw.name === "string" && raw.name.trim() ? { name: raw.name.trim() } : {}),
      ...(typeof raw.contextLength === "number" && raw.contextLength > 0
        ? { contextLength: raw.contextLength }
        : {}),
    });
  }

  return { name, baseUrl, apiKey, api, models: normalizedModels };
}

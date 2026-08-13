/**
 * 预设服务商目录（参考 pi 的内置 catalog：~/.pi/agent/models.json）。
 *
 * - opencode（OpenCode Zen）→ OpenAI Responses API
 * - opencode-go → OpenAI Chat Completions API
 * - deepseek → OpenAI Chat Completions API
 *
 * API Key 均可引用服务端环境变量（`$OPENCODE_API_KEY` / `$DEEPSEEK_API_KEY`），
 * 与 pi 的 `auth.json` 行为一致；密钥在服务端加密落盘，不会出现在前端。
 */
import type { ProviderApi, ProviderModelInfo } from "../../services/providers";

export interface ProviderPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  api: ProviderApi;
  /** 服务端环境变量名提示（仅展示，不强制）。 */
  apiKeyEnv?: string;
  models: ProviderModelInfo[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "opencode",
    name: "OpenCode Zen",
    description: "OpenAI Responses 协议，适合 GPT-5.x 系列",
    baseUrl: "https://opencode.ai/zen/v1",
    api: "responses",
    apiKeyEnv: "OPENCODE_API_KEY",
    models: [
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", contextLength: 1050000 },
      { id: "gpt-5.5", name: "GPT-5.5", contextLength: 1050000 },
      { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", contextLength: 1050000 },
      { id: "gpt-5.4", name: "GPT-5.4", contextLength: 272000 },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", contextLength: 400000 },
      { id: "gpt-5.2", name: "GPT-5.2", contextLength: 400000 },
      { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", contextLength: 400000 },
      { id: "gpt-5.1", name: "GPT-5.1", contextLength: 400000 },
      { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", contextLength: 400000 },
      { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", contextLength: 400000 },
      { id: "grok-4.5", name: "Grok 4.5", contextLength: 500000 },
    ],
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    description: "OpenAI Chat Completions 协议，多模型聚合",
    baseUrl: "https://opencode.ai/zen/go/v1",
    api: "chat/completions",
    apiKeyEnv: "OPENCODE_API_KEY",
    models: [
      { id: "grok-4.5", name: "Grok 4.5" },
      { id: "glm-5.2", name: "GLM-5.2" },
      { id: "glm-5.1", name: "GLM-5.1" },
      { id: "kimi-k3", name: "Kimi K3" },
      { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
      { id: "kimi-k2.6", name: "Kimi K2.6" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextLength: 1000000 },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 1000000 },
      { id: "mimo-v2.5", name: "MiMo V2.5" },
      { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
      { id: "hy3", name: "Hy3" },
      { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", contextLength: 272000 },
      { id: "minimax-m3", name: "MiniMax M3" },
      { id: "minimax-m2.7", name: "MiniMax M2.7" },
      { id: "minimax-m2.5", name: "MiniMax M2.5" },
      { id: "qwen3.8-max", name: "Qwen3.8 Max" },
      { id: "qwen3.7-max", name: "Qwen3.7 Max" },
      { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
      { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek 官方 Chat Completions API",
    baseUrl: "https://api.deepseek.com",
    api: "chat/completions",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextLength: 1000000 },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 1000000 },
    ],
  },
];

export const findPreset = (id: string): ProviderPreset | undefined =>
  PROVIDER_PRESETS.find((preset) => preset.id === id);

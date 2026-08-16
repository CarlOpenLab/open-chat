export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

export interface ModelsProvider {
  name: string;
  models: ModelInfo[];
}

/** 服务端本地 opencode（AI 取本地的）发现的模型。 */
export interface LocalModelInfo {
  /** 形如 `provider/model`（如 `opencode/nemotron-3.5-lightning-free`）。 */
  id: string;
  name: string;
  provider: string;
  providerName: string;
  contextLength?: number;
}

export interface LocalModelsInfo {
  enabled: boolean;
  provider: string;
  models: LocalModelInfo[];
  error?: string;
}

export interface ModelsResponse {
  search: { enabled: boolean; provider: string };
  local?: LocalModelsInfo;
}

/** 上传后的附件元数据：reference 是持久引用，渲染用 URL，agent 用网关侧 path。 */
export interface UploadedAttachment {
  reference: string;
  name: string;
  isImage: boolean;
  /** 网关侧绝对路径（仅供同机 agent 读取，前端不使用）。 */
  path?: string;
}

/** 附件渲染 URL（历史消息图片按引用读取）。 */
export function attachmentUrl(reference: string, name: string): string {
  return `${API_BASE_URL}/api/attachments/${encodeURIComponent(reference)}/${encodeURIComponent(name)}`;
}

/** 把 File 读成 base64 字符串。 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/** Display-ready source item consumed by the `Sources` UI component. */
export interface WebSearchSourceItem {
  key: string;
  title: string;
  url: string;
  description: string;
}

/**
 * Base URL for gateway requests. Defaults to a relative path so that, in dev,
 * requests go through the Vite proxy (`/api` -> http://localhost:8082) and avoid
 * CORS. Set `VITE_API_URL` to target the gateway directly when needed.
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL || "";

/** Optional gateway bearer token (only required when the gateway enables auth). */
export const GATEWAY_API_KEY = import.meta.env.VITE_GATEWAY_API_KEY || "";

export const aiService = {
  /**
   * 获取服务端能力状态：联网搜索可用性 + 本地 opencode（AI 取本地的）
   * 发现的模型/供应商。手动配置的服务商模型仍在客户端本地（IndexedDB），
   * 由 useChatModels 合并展示。
   */
  async getModels(): Promise<ModelsResponse> {
    const response = await fetch(`${API_BASE_URL}/api/models`);
    if (!response.ok) {
      throw new Error("Failed to fetch models");
    }
    return response.json();
  },

  /** Ask a local gateway to open the host OS directory picker. */
  async pickProjectPath(): Promise<{ path?: string; canceled: boolean }> {
    const response = await fetch(`${API_BASE_URL}/api/project-path/pick`, {
      method: "POST",
      headers: GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as {
      path?: unknown;
      canceled?: unknown;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(data.error?.message || `目录选择失败（HTTP ${response.status}）`);
    }
    return {
      path: typeof data.path === "string" ? data.path : undefined,
      canceled: data.canceled === true,
    };
  },

  /**
   * 上传附件（图片/文件）到网关，落盘 `~/.cc-hearts-open-code/attachments/`。
   * 返回持久引用，后续发送消息与历史渲染都只用引用，字节不再回传浏览器。
   */
  async uploadAttachment(file: File): Promise<UploadedAttachment> {
    const dataBase64 = await fileToBase64(file);
    const response = await fetch(`${API_BASE_URL}/api/attachments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : {}),
      },
      body: JSON.stringify({ name: file.name, dataBase64 }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      reference?: unknown;
      name?: unknown;
      isImage?: unknown;
      path?: unknown;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(data.error?.message || `附件上传失败（HTTP ${response.status}）`);
    }
    if (typeof data.reference !== "string" || typeof data.name !== "string") {
      throw new Error("附件上传返回了无效响应");
    }
    return {
      reference: data.reference,
      name: data.name,
      isImage: data.isImage === true,
      ...(typeof data.path === "string" ? { path: data.path } : {}),
    };
  },
};

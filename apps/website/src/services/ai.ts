import { apiRequest, apiUrl } from "./http";

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

export interface GitWorkspaceInfo {
  isRepository: boolean;
  root?: string;
  currentBranch?: string;
  branches: string[];
  dirty: boolean;
  detached: boolean;
}

/** 单个 skill 的展示信息（与网关 /api/skills 返回结构一致）。 */
export interface SkillSummary {
  name: string;
  description: string;
  source: "project" | "global";
  /** 所在 skills 根目录（相对项目目录或 home），如 .claude/skills */
  scope: string;
}

export interface SkillsIndex {
  project: SkillSummary[];
  global: SkillSummary[];
}

/** Display-ready source item consumed by the `Sources` UI component. */
export interface WebSearchSourceItem {
  key: string;
  title: string;
  url: string;
  description: string;
}

/**
 * @description 附件渲染 URL（历史消息图片按引用读取，同源 cookie 鉴权）。
 * @param {string} reference - 附件持久引用
 * @param {string} name - 文件名
 * @returns {string} 图片地址
 */
export function attachmentUrl(reference: string, name: string): string {
  return apiUrl(`/api/attachments/${encodeURIComponent(reference)}/${encodeURIComponent(name)}`);
}

/**
 * @description 把 File 读成 base64 字符串（不含 data URL 前缀）。
 * @param {File} file - 浏览器文件
 * @returns {Promise<string>} base64 内容
 */
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

/**
 * @description 规范化网关返回的 skills 列表。
 * @param {unknown} value - 原始列表
 * @returns {SkillSummary[]} 合法条目
 */
function readSkillSummaries(value: unknown): SkillSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const skill = entry as Partial<SkillSummary>;
    if (typeof skill?.name !== "string" || !skill.name) return [];
    return [
      {
        name: skill.name,
        description: typeof skill.description === "string" ? skill.description : "",
        source: skill.source === "project" ? ("project" as const) : ("global" as const),
        scope: typeof skill.scope === "string" ? skill.scope : "",
      },
    ];
  });
}

/**
 * @description 规范化网关返回的 Git 状态。
 * @param {Partial<GitWorkspaceInfo>} data - 原始响应
 * @returns {GitWorkspaceInfo} Git 状态
 */
function readGitWorkspace(data: Partial<GitWorkspaceInfo>): GitWorkspaceInfo {
  return {
    isRepository: data.isRepository === true,
    root: typeof data.root === "string" ? data.root : undefined,
    currentBranch: typeof data.currentBranch === "string" ? data.currentBranch : undefined,
    branches: Array.isArray(data.branches)
      ? data.branches.filter((branch): branch is string => typeof branch === "string")
      : [],
    dirty: data.dirty === true,
    detached: data.detached === true,
  };
}

export const aiService = {
  /**
   * @description 服务端能力：联网搜索可用性 + 本地 opencode 发现的模型。
   * 手动配置的服务商模型由 `/api/providers` 提供，useChatModels 合并展示。
   * @returns {Promise<ModelsResponse>} 能力与模型
   */
  async getModels(): Promise<ModelsResponse> {
    return apiRequest<ModelsResponse>("/api/models", { errorMessage: "模型列表加载失败" });
  },

  /**
   * @description 请求网关所在主机弹出系统目录选择器（仅本机访问可用）。
   * @returns {Promise<{ path?: string; canceled: boolean }>} 选择结果
   */
  async pickProjectPath(): Promise<{ path?: string; canceled: boolean }> {
    const data = await apiRequest<{ path?: unknown; canceled?: unknown }>(
      "/api/project-path/pick",
      { method: "POST", errorMessage: "目录选择失败" },
    );
    return {
      path: typeof data.path === "string" ? data.path : undefined,
      canceled: data.canceled === true,
    };
  },

  /**
   * @description 读取网关的默认工作目录（未选择项目目录时 agent 使用）。
   * @returns {Promise<string>} 目录路径
   */
  async getDefaultProjectPath(): Promise<string> {
    const data = await apiRequest<{ path?: unknown }>("/api/project-path/default", {
      errorMessage: "默认目录读取失败",
    });
    return typeof data.path === "string" ? data.path.trim() : "";
  },

  /**
   * @description 读取项目目录的 Git 状态。
   * @param {string} path - 项目目录
   * @returns {Promise<GitWorkspaceInfo>} Git 状态
   */
  async getGitWorkspace(path: string): Promise<GitWorkspaceInfo> {
    return readGitWorkspace(
      await apiRequest<Partial<GitWorkspaceInfo>>(
        `/api/project-path/git?${new URLSearchParams({ path })}`,
        { errorMessage: "Git 状态读取失败" },
      ),
    );
  },

  /**
   * @description 切换项目目录的 Git 分支。
   * @param {string} path - 项目目录
   * @param {string} branch - 目标分支
   * @returns {Promise<GitWorkspaceInfo>} 切换后的 Git 状态
   */
  async switchGitBranch(path: string, branch: string): Promise<GitWorkspaceInfo> {
    return readGitWorkspace(
      await apiRequest<Partial<GitWorkspaceInfo>>("/api/project-path/git/switch", {
        method: "POST",
        json: { path, branch },
        errorMessage: "Git 分支切换失败",
      }),
    );
  },

  /**
   * @description 读取项目 / 全局 skills（输入区 "/" 建议用）；projectPath 为空时只返回全局。
   * @param {string} projectPath - 项目目录
   * @returns {Promise<SkillsIndex>} skills 列表
   */
  async getSkills(projectPath = ""): Promise<SkillsIndex> {
    const trimmed = projectPath.trim();
    const query = trimmed ? `?${new URLSearchParams({ projectPath: trimmed })}` : "";
    const data = await apiRequest<Partial<SkillsIndex>>(`/api/skills${query}`, {
      errorMessage: "Skills 列表读取失败",
    });
    return { project: readSkillSummaries(data.project), global: readSkillSummaries(data.global) };
  },

  /**
   * @description 上传附件到网关（落盘 `<数据根>/attachments/`），之后只用持久引用收发。
   * @param {File} file - 浏览器文件
   * @returns {Promise<UploadedAttachment>} 附件元数据
   */
  async uploadAttachment(file: File): Promise<UploadedAttachment> {
    const data = await apiRequest<{
      reference?: unknown;
      name?: unknown;
      isImage?: unknown;
      path?: unknown;
    }>("/api/attachments", {
      method: "POST",
      json: { name: file.name, dataBase64: await fileToBase64(file) },
      errorMessage: "附件上传失败",
    });
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

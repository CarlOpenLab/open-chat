/**
 * 项目目录相关 REST：目录历史（共享数据）、系统目录选择器 / 默认目录 / Git / Skills
 * （读写本机文件系统，只对本机回环请求开放）。
 */
import { Router } from "express";
import { defaultWorkspaceDir } from "../attachments";
import { GatewayError } from "../error";
import { readGitWorkspace, switchGitBranch } from "../gitWorkspace";
import {
  optionalString,
  parseProjectPath,
  requireLoopback,
  requiredQuery,
  toGatewayError,
} from "../http";
import { pickProjectDirectory } from "../projectPicker";
import { listSkills } from "../skills";
import type { WorkspaceStore } from "../store/workspace";

/**
 * @description 创建项目目录路由（挂载在 `/api/project-path`）。
 * @param {WorkspaceStore} store - 工作区存储
 * @returns {Router} Express 路由
 */
export function createProjectPathRouter(store: WorkspaceStore): Router {
  const router = Router();

  router.get("/history", (_req, res) => {
    res.json({ paths: store.projectPaths.list() });
  });

  router.post("/history", (req, res) => {
    const path = optionalString((req.body as { path?: unknown } | undefined)?.path);
    if (!path) throw GatewayError.invalidRequest("path 是必填项");
    res.json({ paths: store.projectPaths.remember(path) });
  });

  router.delete("/history", (req, res) => {
    res.json({ paths: store.projectPaths.forget(requiredQuery(req, "path")) });
  });

  router.post("/pick", requireLoopback, async (_req, res) => {
    try {
      const path = await pickProjectDirectory();
      res.json({ canceled: !path, ...(path ? { path } : {}) });
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      console.error("Project directory picker failed:", err);
      throw GatewayError.upstream(err instanceof Error ? err.message : "系统目录选择器不可用");
    }
  });

  router.get("/default", requireLoopback, (_req, res) => {
    res.json({ path: defaultWorkspaceDir() });
  });

  router.get("/git", requireLoopback, async (req, res) => {
    const projectPath = parseProjectPath(requiredQuery(req, "path"));
    if (!projectPath) throw GatewayError.invalidRequest("path 是必填项");
    try {
      res.json(await readGitWorkspace(projectPath));
    } catch (err) {
      throw toGatewayError(err, "Git 状态读取失败");
    }
  });

  router.post("/git/switch", requireLoopback, async (req, res) => {
    const body = req.body as { path?: unknown; branch?: unknown };
    const projectPath = parseProjectPath(body.path);
    if (!projectPath) throw GatewayError.invalidRequest("path 是必填项");
    if (typeof body.branch !== "string" || !body.branch.trim()) {
      throw GatewayError.invalidRequest("branch 是必填项");
    }
    try {
      res.json(await switchGitBranch(projectPath, body.branch.trim()));
    } catch (err) {
      throw toGatewayError(err, "Git 分支切换失败");
    }
  });

  return router;
}

/**
 * @description 创建 Skills 路由（挂载在 `/api/skills`）：输入区 "/" 建议用，projectPath 缺省只返回全局。
 * @returns {Router} Express 路由
 */
export function createSkillsRouter(): Router {
  const router = Router();

  router.get("/", requireLoopback, async (req, res) => {
    const rawProjectPath = optionalString(req.query.projectPath);
    const projectPath = rawProjectPath ? parseProjectPath(rawProjectPath) : undefined;
    try {
      res.json(await listSkills(projectPath ?? ""));
    } catch (err) {
      throw toGatewayError(err, "Skills 列表读取失败");
    }
  });

  return router;
}

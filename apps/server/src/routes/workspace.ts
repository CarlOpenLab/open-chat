/**
 * 工作区级 REST：偏好、数据库概况、全量导出、浏览器旧数据导入。
 */
import { Router } from "express";
import type { LegacyImportPayload } from "@cc-heart/open-chat-types";
import { GatewayError } from "../error";
import { importLegacyPayload } from "../store/legacyImport";
import { parsePreferencesPatch } from "../store/preferences";
import type { WorkspaceStore } from "../store/workspace";

/**
 * @description 创建偏好路由（挂载在 `/api/preferences`）。
 * @param {WorkspaceStore} store - 工作区存储
 * @returns {Router} Express 路由
 */
export function createPreferenceRouter(store: WorkspaceStore): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ preferences: store.preferences.get() });
  });

  router.patch("/", (req, res) => {
    res.json({ preferences: store.preferences.update(parsePreferencesPatch(req.body)) });
  });

  return router;
}

/**
 * @description 创建工作区路由（挂载在 `/api/workspace`）。
 * @param {WorkspaceStore} store - 工作区存储
 * @returns {Router} Express 路由
 */
export function createWorkspaceRouter(store: WorkspaceStore): Router {
  const router = Router();

  router.get("/info", (_req, res) => {
    res.json(store.info());
  });

  router.get("/export", (_req, res) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Disposition", `attachment; filename="open-chat-backup-${stamp}.json"`);
    res.json(store.exportAll());
  });

  router.post("/import-legacy", (req, res) => {
    const body = req.body as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw GatewayError.invalidRequest("请求体必须是 JSON 对象");
    }
    res.json({ imported: importLegacyPayload(store, body as LegacyImportPayload) });
  });

  return router;
}

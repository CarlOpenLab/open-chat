/**
 * 模型服务商 REST：`/api/providers`。响应只含 Key 掩码，明文 Key 只在网关内部使用。
 */
import { Router } from "express";
import { GatewayError } from "../error";
import { parseProviderInput, toProviderView } from "../store/providers";
import type { WorkspaceStore } from "../store/workspace";

/**
 * @description 创建服务商路由。
 * @param {WorkspaceStore} store - 工作区存储
 * @returns {Router} Express 路由
 */
export function createProviderRouter(store: WorkspaceStore): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ providers: store.providers.list().map(toProviderView) });
  });

  router.post("/", (req, res) => {
    const provider = store.providers.create(parseProviderInput(req.body, "create"));
    res.status(201).json({ provider: toProviderView(provider) });
  });

  router.patch("/:id", (req, res) => {
    const provider = store.providers.update(req.params.id, parseProviderInput(req.body, "update"));
    if (!provider) throw GatewayError.notFound(`provider not found: ${req.params.id}`);
    res.json({ provider: toProviderView(provider) });
  });

  router.delete("/:id", (req, res) => {
    res.json({ ok: true, deleted: store.providers.delete(req.params.id) });
  });

  return router;
}

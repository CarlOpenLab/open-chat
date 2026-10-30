/**
 * 任务看板 REST：`/api/tasks`（Web UI）与 `/api/board/tasks`（看板 AI 助手经 curl 调用，
 * 系统指令里写的是这个路径）挂载同一个路由，行为完全一致。
 */
import { Router, type Request } from "express";
import { GatewayError } from "../error";
import { parseTaskCreateInput, parseTaskInput } from "../store/tasks";
import type { WorkspaceStore } from "../store/workspace";

/**
 * @description 删除确认门槛：请求体 `{"confirmed": true}` 或查询参数 `?confirmed=true`。
 * 删除不可逆，仅靠提示词无法保证 agent 先征得用户同意，因此在 API 层兜底。
 * @param {Request} req - Express 请求
 * @returns {boolean} 已确认时为 true
 */
function isDeleteConfirmed(req: Request): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  return body.confirmed === true || req.query.confirmed === "true";
}

/**
 * @description 创建任务路由。
 * @param {WorkspaceStore} store - 工作区存储
 * @returns {Router} Express 路由
 */
export function createTaskRouter(store: WorkspaceStore): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ tasks: store.tasks.list() });
  });

  router.get("/:id", (req, res) => {
    const task = store.tasks.get(req.params.id);
    if (!task) throw GatewayError.notFound(`task not found: ${req.params.id}`);
    res.json({ task });
  });

  router.post("/", (req, res) => {
    const task = store.tasks.create(parseTaskCreateInput(req.body));
    res.status(201).json({ task });
  });

  router.patch("/:id", (req, res) => {
    const task = store.tasks.update(req.params.id, parseTaskInput(req.body));
    if (!task) throw GatewayError.notFound(`task not found: ${req.params.id}`);
    res.json({ task });
  });

  router.delete("/:id", (req, res) => {
    if (!isDeleteConfirmed(req)) {
      throw GatewayError.invalidRequest(
        '删除任务前必须先向用户确认，征得明确同意后在请求体中加入 "confirmed": true 再重试',
      );
    }
    if (!store.tasks.delete(req.params.id)) {
      throw GatewayError.notFound(`task not found: ${req.params.id}`);
    }
    res.json({ ok: true });
  });

  return router;
}

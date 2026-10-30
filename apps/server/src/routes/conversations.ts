/**
 * 会话索引 REST：`/api/conversations`。
 *
 * 前端按会话粒度写入（PUT 整条记录、幂等），每个会话的写请求在浏览器侧串行，
 * 因此网关按 last-write-wins 直接覆盖即可。删除与归档同样幂等。
 */
import { Router } from "express";
import { GatewayError } from "../error";
import { parseConversationKey, parseConversationRecord } from "../store/conversations";
import type { WorkspaceStore } from "../store/workspace";

/**
 * @description 创建会话路由。
 * @param {WorkspaceStore} store - 工作区存储
 * @returns {Router} Express 路由
 */
export function createConversationRouter(store: WorkspaceStore): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ conversations: store.conversations.list() });
  });

  // 清空全部会话（设置页「清空历史」）：任务保留，关联自动解除
  router.delete("/", (_req, res) => {
    res.json({ ok: true, deleted: store.conversations.deleteAll() });
  });

  router.put("/:key", (req, res) => {
    const key = parseConversationKey(req.params.key);
    const conversation = store.conversations.upsert(parseConversationRecord(key, req.body));
    res.json({ conversation });
  });

  router.delete("/:key", (req, res) => {
    const key = parseConversationKey(req.params.key);
    res.json({ ok: true, deleted: store.conversations.delete(key) });
  });

  router.post("/:key/archive", (req, res) => {
    const key = parseConversationKey(req.params.key);
    res.json({ ok: true, archived: store.conversations.archive(key) });
  });

  router.get("/:key/transcript", (req, res) => {
    const key = parseConversationKey(req.params.key);
    res.json({ messages: store.conversations.getTranscript(key) });
  });

  router.put("/:key/transcript", (req, res) => {
    const key = parseConversationKey(req.params.key);
    const messages = (req.body as { messages?: unknown } | undefined)?.messages;
    if (!Array.isArray(messages)) throw GatewayError.invalidRequest("messages 必须是数组");
    store.conversations.saveTranscript(key, messages);
    res.json({ ok: true });
  });

  return router;
}

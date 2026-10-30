/**
 * 本地 Agent 会话 REST：`/api/acp/*`（agent 列表、会话加载 / 配置、实时流订阅、取消回合）。
 */
import { Router } from "express";
import type { AgentManager } from "../agentManager";
import { GatewayError } from "../error";
import {
  optionalString,
  parseProjectPath,
  requiredBodyString,
  requiredQuery,
  toGatewayError,
} from "../http";

/**
 * @description 创建 Agent 会话路由（挂载在 `/api/acp`）。
 * @param {AgentManager} agentManager - 本地 agent 管理器
 * @returns {Router} Express 路由
 */
export function createAgentRouter(agentManager: AgentManager): Router {
  const router = Router();

  router.get("/agents", (_req, res) => {
    res.json({ agents: agentManager.listAgents() });
  });

  router.get("/session", async (req, res) => {
    const agentId = requiredQuery(req, "agentId");
    const conversationId = requiredQuery(req, "conversationId");
    try {
      res.json(
        await agentManager.getSessionState(
          agentId,
          conversationId,
          parseProjectPath(req.query.projectPath),
          optionalString(req.query.providerSessionId),
        ),
      );
    } catch (err) {
      throw toGatewayError(err, "ACP 会话配置加载失败");
    }
  });

  router.post("/session/config", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const agentId = requiredBodyString(body, "agentId");
    const conversationId = requiredBodyString(body, "conversationId");
    const configId = requiredBodyString(body, "configId");
    if (typeof body.value !== "string" && typeof body.value !== "boolean") {
      throw GatewayError.invalidRequest("value 必须是字符串或布尔值");
    }
    try {
      res.json(
        await agentManager.setSessionConfigOption(
          agentId,
          conversationId,
          configId,
          body.value,
          parseProjectPath(body.projectPath),
          optionalString(body.providerSessionId),
        ),
      );
    } catch (err) {
      throw toGatewayError(err, "ACP 会话配置更新失败");
    }
  });

  // 会话实时输出：SSE 订阅（多标签 / 刷新恢复后继续观看运行中的回合）
  router.get("/session/stream", async (req, res) => {
    const agentId = requiredQuery(req, "agentId");
    const conversationId = requiredQuery(req, "conversationId");
    let subscribed: boolean;
    try {
      subscribed = await agentManager.subscribeSessionStream(agentId, conversationId, res);
    } catch (err) {
      throw toGatewayError(err, "ACP 会话流订阅失败");
    }
    if (!subscribed) {
      // 回合可能恰好在两次请求之间结束：没有活动流是正常竞态，不是资源缺失
      res.status(204).end();
      return;
    }
    // SSE 心跳：长时间无输出时防止代理 / 浏览器超时断连
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
    }, 15_000);
    res.on("close", () => clearInterval(heartbeat));
  });

  // 取消运行中的回合（多标签 / 刷新后停止孤儿回合）
  router.post("/session/cancel", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const agentId = requiredBodyString(body, "agentId");
    const conversationId = requiredBodyString(body, "conversationId");
    try {
      res.json({ cancelled: await agentManager.cancelTurn(agentId, conversationId) });
    } catch (err) {
      throw toGatewayError(err, "ACP 回合取消失败");
    }
  });

  return router;
}

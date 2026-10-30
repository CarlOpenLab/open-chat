/**
 * Web 访问控制：每次启动生成一次性密码，浏览器登录后获得 HttpOnly 会话 cookie。
 * 既有的 API-key 客户端（Authorization: Bearer <gatewayApiKey>）同样放行。
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { GatewayError } from "./error";

/** 进程内的一次性密码与会话 token，网关停止即失效。 */
export interface WebAccessControl {
  password: string;
  sessionToken: string;
}

const COOKIE_NAME = "open_chat_access";

/**
 * @description 生成本次启动的访问密码与会话 token。
 * @returns {WebAccessControl} 访问控制凭据
 */
export function createWebAccessControl(): WebAccessControl {
  return {
    password: randomBytes(12).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

/**
 * @description 常量时间比较两个密钥，避免时序侧信道。
 * @param {string} value - 待校验的值
 * @param {string} expected - 期望值
 * @returns {boolean} 相同时为 true
 */
function sameSecret(value: string, expected: string): boolean {
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

/**
 * @description 从 Cookie 头读取指定 cookie。
 * @param {Request} req - Express 请求
 * @param {string} name - cookie 名
 * @returns {string} cookie 值；不存在时为空串
 */
function readCookie(req: Request, name: string): string {
  const prefix = `${name}=`;
  for (const part of (req.header("cookie") || "").split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return "";
}

/**
 * @description 判断请求是否已获得 Web 访问权限（会话 cookie 或网关 API Key）。
 * @param {Request} req - Express 请求
 * @param {WebAccessControl} access - 访问控制凭据
 * @param {string} gatewayApiKey - 网关 API Key（空串表示未启用）
 * @returns {boolean} 已授权时为 true
 */
function hasWebAccess(req: Request, access: WebAccessControl, gatewayApiKey: string): boolean {
  const header = req.header("authorization");
  if (
    gatewayApiKey &&
    header?.startsWith("Bearer ") &&
    sameSecret(header.slice(7), gatewayApiKey)
  ) {
    return true;
  }
  return sameSecret(readCookie(req, COOKIE_NAME), access.sessionToken);
}

/**
 * @description 创建访问控制路由（挂载在 `/api/access`，始终公开，供前端探测登录状态）。
 * 未启用密码（access 为 undefined，纯 API-key 场景）时 status 恒为已授权。
 * @param {WebAccessControl | undefined} access - 访问控制凭据
 * @param {string} gatewayApiKey - 网关 API Key
 * @returns {Router} Express 路由
 */
export function createAccessRouter(
  access: WebAccessControl | undefined,
  gatewayApiKey: string,
): Router {
  const router = Router();

  router.get("/status", (req, res) => {
    res.json({ authorized: access ? hasWebAccess(req, access, gatewayApiKey) : true });
  });

  router.post("/login", (req, res) => {
    if (access) {
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!sameSecret(password, access.password)) {
        res.status(401).json({ error: { message: "密码不正确", type: "authentication_error" } });
        return;
      }
      res.setHeader(
        "Set-Cookie",
        `${COOKIE_NAME}=${access.sessionToken}; Path=/; HttpOnly; SameSite=Strict`,
      );
    }
    res.json({ authorized: true });
  });

  router.post("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ authorized: false });
  });

  return router;
}

/**
 * @description `/api` 鉴权中间件：启用密码时校验会话 cookie（或 API Key），只启用 API Key 时校验 Bearer。
 * 静态资源不经过此中间件，登录页可以正常加载。
 * @param {WebAccessControl | undefined} access - 访问控制凭据
 * @param {string} gatewayApiKey - 网关 API Key
 * @returns {(req: Request, res: Response, next: NextFunction) => void} Express 中间件
 */
export function requireApiAccess(access: WebAccessControl | undefined, gatewayApiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (access) {
      if (hasWebAccess(req, access, gatewayApiKey)) return next();
      res.status(401).json({ error: { message: "请输入访问密码", type: "authentication_error" } });
      return;
    }
    if (!gatewayApiKey) return next();
    const header = req.header("authorization");
    if (header?.startsWith("Bearer ") && sameSecret(header.slice(7).trim(), gatewayApiKey)) {
      return next();
    }
    res.status(401).json(GatewayError.unauthorized().toResponse());
  };
}

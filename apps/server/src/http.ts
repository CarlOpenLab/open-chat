/**
 * 路由共用的 HTTP 工具：参数校验、错误响应、来源判断。
 *
 * Express 5 会把 async 处理函数抛出的异常交给错误中间件，路由里直接
 * `throw GatewayError.xxx()` 即可，由 `jsonErrorHandler` 统一转成 JSON 错误体。
 */
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { isForeignKeyViolation } from "./db/database";
import { GatewayError } from "./error";

/**
 * @description 以网关错误的状态码与 OpenAI 风格错误体响应。
 * @param {Response} res - Express 响应
 * @param {GatewayError} err - 网关错误
 * @returns {void}
 */
export function sendGatewayError(res: Response, err: GatewayError): void {
  res.status(err.status).json(err.toResponse());
}

/**
 * @description 把任意异常映射为网关错误：外键冲突 → 409，其它未知异常 → 502 并记录日志。
 * @param {unknown} err - 捕获的异常
 * @param {string} fallback - 无错误信息时的提示
 * @returns {GatewayError} 可直接响应的网关错误
 */
export function toGatewayError(err: unknown, fallback: string): GatewayError {
  if (err instanceof GatewayError) return err;
  if (isForeignKeyViolation(err)) {
    return new GatewayError({
      status: 409,
      message: "引用的任务或会话不存在",
      type: "invalid_request_error",
      code: "conflict",
    });
  }
  console.error(`${fallback}:`, err);
  return GatewayError.upstream(err instanceof Error ? err.message : fallback);
}

/**
 * @description 统一的路由错误响应（保留给仍使用 try/catch 的路由）。
 * @param {Response} res - Express 响应
 * @param {unknown} err - 捕获的异常
 * @param {string} fallback - 无错误信息时的提示
 * @returns {void}
 */
export function sendRouteError(res: Response, err: unknown, fallback: string): void {
  sendGatewayError(res, toGatewayError(err, fallback));
}

/**
 * @description Express 错误中间件：JSON 解析失败 → 400，其余按 toGatewayError 映射。
 * 响应头已发出（如 SSE 中途出错）时只结束连接。
 * @param {unknown} err - 异常
 * @param {Request} _req - Express 请求
 * @param {Response} res - Express 响应
 * @param {NextFunction} _next - 下一个中间件（Express 依据参数个数识别错误中间件）
 * @returns {void}
 */
export function jsonErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if ((err as { type?: unknown })?.type === "entity.parse.failed") {
    sendGatewayError(res, GatewayError.invalidRequest("请求体不是合法的 JSON"));
    return;
  }
  if ((err as { type?: unknown })?.type === "entity.too.large") {
    sendGatewayError(res, GatewayError.invalidRequest("请求体过大"));
    return;
  }
  sendGatewayError(res, toGatewayError(err, "请求处理失败"));
}

/**
 * @description 读取必填的查询参数。
 * @param {Request} req - Express 请求
 * @param {string} name - 参数名
 * @returns {string} 去除首尾空白后的值
 * @throws {GatewayError} 缺失或为空时抛出 400
 */
export function requiredQuery(req: Request, name: string): string {
  const value = req.query[name];
  if (typeof value !== "string" || !value.trim()) {
    throw GatewayError.invalidRequest(`${name} 是必填项`);
  }
  return value.trim();
}

/**
 * @description 读取请求体中的必填字符串字段。
 * @param {Record<string, unknown>} body - 请求体
 * @param {string} name - 字段名
 * @returns {string} 去除首尾空白后的值
 * @throws {GatewayError} 缺失或为空时抛出 400
 */
export function requiredBodyString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value.trim()) {
    throw GatewayError.invalidRequest(`${name} 是必填项`);
  }
  return value.trim();
}

/**
 * @description 读取可选字符串：非字符串或空白视为未提供。
 * @param {unknown} value - 原始值
 * @returns {string | undefined} 去除首尾空白后的值
 */
export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * @description 校验项目目录：必须是网关主机上存在的绝对路径目录。
 * @param {unknown} value - 原始路径
 * @returns {string | undefined} 合法目录；未提供时为 undefined
 * @throws {GatewayError} 路径非字符串、非绝对路径或目录不存在时抛出 400
 */
export function parseProjectPath(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw GatewayError.invalidRequest("projectPath 必须是字符串");
  const projectPath = value.trim();
  if (!projectPath) return undefined;
  if (!isAbsolute(projectPath)) {
    throw GatewayError.invalidRequest("projectPath 必须是绝对路径");
  }
  try {
    if (!statSync(projectPath).isDirectory()) {
      throw new Error("不是目录");
    }
  } catch {
    throw GatewayError.invalidRequest(`项目目录不存在或不可访问：${projectPath}`);
  }
  return projectPath;
}

/**
 * @description 判断请求是否来自本机回环地址（目录选择器、Git 等本机能力只对本机开放）。
 * @param {Request} req - Express 请求
 * @returns {boolean} 来自 127.0.0.1 / ::1 时为 true
 */
export function isLoopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress || "";
  return address === "::1" || address === "127.0.0.1" || address.startsWith("::ffff:127.");
}

/**
 * @description 中间件：拒绝非本机请求。
 * @param {Request} req - Express 请求
 * @param {Response} _res - Express 响应
 * @param {NextFunction} next - 下一个中间件
 * @returns {void}
 */
export function requireLoopback(req: Request, _res: Response, next: NextFunction): void {
  if (!isLoopbackRequest(req)) throw GatewayError.unauthorized();
  next();
}

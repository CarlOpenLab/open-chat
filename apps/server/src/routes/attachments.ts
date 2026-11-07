/**
 * 附件 REST：浏览器上传落盘到 `<数据根>/attachments/<uuid>/<name>`，返回持久引用
 * `cc-attachment:<uuid>`；agent 发送时直接读网关侧磁盘路径（同机）。
 */
import { Router } from "express";
import { attachmentContentType, type AttachmentStore } from "../attachments";
import { GatewayError } from "../error";
import { toGatewayError } from "../http";
import type { AttachmentIndexStore } from "../store/attachments";

/**
 * @description 创建附件路由（挂载在 `/api/attachments`）。
 * @param {AttachmentStore} attachments - 附件存储
 * @param {AttachmentIndexStore} [index] - 附件元数据索引（SQLite）；不传时不提供列表
 * @returns {Router} Express 路由
 */
export function createAttachmentRouter(
  attachments: AttachmentStore,
  index?: AttachmentIndexStore,
): Router {
  const router = Router();

  // 已登记附件列表（按最近使用排序）：元数据在库里，字节在数据目录
  router.get("/", (_req, res) => {
    if (!index) {
      res.json({ attachments: [], totalBytes: 0 });
      return;
    }
    res.json({ attachments: index.list(), totalBytes: index.totalBytes() });
  });

  router.post("/", (req, res) => {
    const body = req.body as { name?: unknown; dataBase64?: unknown };
    if (typeof body.name !== "string" || typeof body.dataBase64 !== "string") {
      throw GatewayError.invalidRequest("name 与 dataBase64 是必填项");
    }
    try {
      const stored = attachments.importBytes(body.name, Buffer.from(body.dataBase64, "base64"));
      res.json({ ok: true, ...stored });
    } catch (err) {
      throw toGatewayError(err, "附件上传失败");
    }
  });

  // 手动触发孤儿附件清理（默认保留 7 天未修改的目录）
  router.post("/sweep", (_req, res) => {
    res.json({ ok: true, removed: attachments.sweep() });
  });

  // 渲染历史消息图片：reference(UUID) + 文件名双重校验，防路径穿越
  router.get("/:reference/:name", (req, res) => {
    const name = String(req.params.name);
    try {
      const bytes = attachments.read(String(req.params.reference), name);
      res.setHeader("Content-Type", attachmentContentType(name));
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.send(bytes);
    } catch (err) {
      if (err instanceof Error && err.message.includes("不存在")) {
        throw GatewayError.invalidRequest("附件不存在或引用无效");
      }
      throw toGatewayError(err, "附件读取失败");
    }
  });

  return router;
}

/**
 * 网关侧附件存储：把 Web UI 上传的图片/文件落盘到用户数据目录
 * `~/.cc-hearts-open-code/attachments/<uuid>/<原文件名>`，返回持久引用
 * `cc-attachment:<uuid>`。
 *
 * 设计沿用了 Waku 的方案：
 * - 字节只走「浏览器 → 网关」一段，之后 agent CLI（与网关同机）直接读
 *   磁盘路径，模型请求里只出现 `@路径` 文本 mention；
 * - 每个附件一个 UUID 目录，先写 `.tmp` 再原子 rename，上传中断不留半截；
 * - reference 用 UUID，读取时校验路径归属，杜绝路径穿越；
 * - 无项目目录时（projectPath 为空）默认工作目录同样落在数据根下
 *   `~/.cc-hearts-open-code/workspace/`。
 *
 * 数据根目录可用 `OPEN_CHAT_DATA_DIR` 环境变量覆盖。
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 用户数据目录名（默认位于用户主目录下）。 */
export const DATA_DIR_NAME = ".cc-hearts-open-code";
/** 附件持久引用前缀。 */
export const ATTACHMENT_SCHEME = "cc-attachment:";
/** 单个附件体积上限（base64 传输会放大 ~1/3，因此按 32MB 源字节控制）。 */
export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "tif",
  "tiff",
  "ico",
  "pnm",
  "pbm",
  "pgm",
  "ppm",
]);

export interface StoredAttachment {
  /** 持久引用，形如 `cc-attachment:<uuid>`。渲染/发送都用它。 */
  reference: string;
  /** 网关主机上的绝对路径（同机 agent CLI 可直接读取）。 */
  path: string;
  name: string;
  isImage: boolean;
}

/** 数据根目录：`OPEN_CHAT_DATA_DIR` 优先，默认用户主目录下的隐藏目录。 */
export function dataRootDir(): string {
  const override = process.env.OPEN_CHAT_DATA_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), DATA_DIR_NAME);
}

/** 未选择项目目录时，agent 的默认工作目录。 */
export function defaultWorkspaceDir(): string {
  return path.join(dataRootDir(), "workspace");
}

export function isImageName(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

function contentTypeForName(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const table: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    tif: "image/tiff",
    tiff: "image/tiff",
    ico: "image/x-icon",
  };
  return table[extension] ?? "application/octet-stream";
}

/** 附件名只保留文件名部分，拒绝空名与路径分隔符。 */
function safeName(name: string): string {
  const base = path.basename(name.trim());
  if (!base || base === "." || base === ".." || base.includes("/") || base.includes("\\")) {
    throw new Error(`非法的附件名：${name}`);
  }
  return base;
}

function referenceId(reference: string): string {
  const id = reference.startsWith(ATTACHMENT_SCHEME)
    ? reference.slice(ATTACHMENT_SCHEME.length)
    : reference;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("非法的附件引用");
  return id;
}

export class AttachmentStore {
  constructor(private readonly root: string = path.join(dataRootDir(), "attachments")) {}

  /** 把内存中的字节落盘为一个附件，返回持久引用与网关侧路径。 */
  importBytes(name: string, bytes: Buffer): StoredAttachment {
    const safe = safeName(name);
    if (bytes.length === 0) throw new Error("附件内容为空");
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB 上限`);
    }
    const id = randomUUID();
    const staging = path.join(this.root, `.${id}.tmp`);
    const destination = path.join(this.root, id);
    try {
      fs.mkdirSync(staging, { recursive: true });
      fs.writeFileSync(path.join(staging, safe), bytes);
      fs.renameSync(staging, destination);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    return {
      reference: `${ATTACHMENT_SCHEME}${id}`,
      path: path.join(destination, safe),
      name: safe,
      isImage: isImageName(safe),
    };
  }

  /** 解析引用对应的附件根目录；引用非法或不存在时返回 null。 */
  pathFor(reference: string): string | null {
    let id: string;
    try {
      id = referenceId(reference);
    } catch {
      return null;
    }
    const directory = path.join(this.root, id);
    if (!fs.existsSync(directory)) return null;
    return directory;
  }

  /**
   * 按内容去重落盘：同一份字节始终映射到同一个引用，重复导入（历史多次
   * 加载、同一图片多次出现）不重复占用磁盘。目录 id 由内容 sha256 派生，
   * 仍满足引用校验规则。
   */
  importBytesDeduped(name: string, bytes: Buffer): StoredAttachment {
    const safe = safeName(name);
    if (bytes.length === 0) throw new Error("附件内容为空");
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB 上限`);
    }
    const id = sha256ReferenceId(bytes);
    const directory = path.join(this.root, id);
    const file = path.join(directory, safe);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return {
        reference: `${ATTACHMENT_SCHEME}${id}`,
        path: file,
        name: safe,
        isImage: isImageName(safe),
      };
    }
    const staging = path.join(this.root, `.${id}.tmp`);
    try {
      fs.mkdirSync(staging, { recursive: true });
      fs.writeFileSync(path.join(staging, safe), bytes);
      fs.renameSync(staging, directory);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      // 并发写入同一内容时目录可能已由另一请求建好，直接复用。
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw error;
    }
    return {
      reference: `${ATTACHMENT_SCHEME}${id}`,
      path: file,
      name: safe,
      isImage: isImageName(safe),
    };
  }

  /** 按引用 + 文件名读取字节，校验路径归属，杜绝目录穿越。 */
  read(reference: string, name: string): Buffer {
    const directory = this.pathFor(reference);
    if (!directory) throw new Error("附件不存在或引用无效");
    const safe = safeName(name);
    const file = path.join(directory, safe);
    if (!file.startsWith(directory + path.sep)) {
      throw new Error("附件路径不属于其引用");
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error("附件文件不存在");
    }
    return fs.readFileSync(file);
  }

  /**
   * 清理超过 `maxAgeMs` 未被修改的附件目录（上传后长时间未发送的孤儿）。
   * 返回清理掉的目录数。启动时调用一次即可。
   */
  sweep(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
    if (!fs.existsSync(this.root)) return 0;
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const entry of fs.readdirSync(this.root)) {
      if (entry.startsWith(".")) continue; // 暂存目录不动
      const directory = path.join(this.root, entry);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(directory);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      if (stat.mtimeMs < cutoff) {
        try {
          fs.rmSync(directory, { recursive: true, force: true });
          removed += 1;
        } catch {
          // 单个目录清理失败不阻塞其余
        }
      }
    }
    return removed;
  }
}

/** GET 附件响应头辅助。 */
export function attachmentContentType(name: string): string {
  return contentTypeForName(name);
}

/**
 * 由内容派生稳定引用 id（sha256 前 32 位十六进制，格式化为 8-4-4-4-12，
 * 与 `referenceId` 的 UUID 校验规则兼容）。同一图片多次导入共用同一引用。
 */
function sha256ReferenceId(bytes: Buffer): string {
  const hex = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 网关级共享附件存储（Web UI 上传与 codex 历史图片导入共用同一目录）。 */
export const attachmentStore = new AttachmentStore();

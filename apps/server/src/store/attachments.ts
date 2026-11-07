/**
 * 附件元数据索引（attachments 表）。
 *
 * 字节仍由 `AttachmentStore` 落盘（`<数据根>/attachments/<id>/<name>`，同机
 * agent 直接读路径），这里只登记引用、路径、大小与时间：便于按引用回查、
 * 统计占用、清理磁盘上已消失的条目，以及把自己上传的附件纳入备份导出。
 */
import type { Database } from "../db/database";

export interface AttachmentRecord {
  /** 引用 id（UUID 或内容派生的 sha256 id），对应 `cc-attachment:<id>`。 */
  id: string;
  name: string;
  /** 网关侧绝对路径。 */
  path: string;
  size: number;
  isImage: boolean;
  createdAt: number;
  lastUsedAt: number;
}

export interface AttachmentRecordInput {
  id: string;
  name: string;
  path: string;
  size: number;
  isImage: boolean;
  /** 落盘时间（导入历史时可能需要用原时间），缺省取当前时间。 */
  timestamp?: number;
}

const LIST_LIMIT_MAX = 2000;

interface AttachmentRow {
  id: string;
  name: string;
  path: string;
  size: number;
  is_image: number;
  created_at: number;
  last_used_at: number;
}

function toRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    size: row.size,
    isImage: row.is_image === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export class AttachmentIndexStore {
  constructor(private readonly db: Database) {}

  count(): number {
    const row = this.db.prepare("SELECT count(*) AS n FROM attachments").get() as { n: number };
    return row.n;
  }

  /** 索引里登记的总字节数。 */
  totalBytes(): number {
    const row = this.db.prepare("SELECT COALESCE(sum(size), 0) AS n FROM attachments").get() as {
      n: number;
    };
    return row.n;
  }

  /**
   * @description 登记一个已落盘的附件。内容去重后同一 id 会被反复登记，此时只刷新
   * 使用时间，保留首次创建时间。
   * @param {AttachmentRecordInput} input - 附件元数据
   * @returns {AttachmentRecord} 落库后的记录
   */
  record(input: AttachmentRecordInput): AttachmentRecord {
    const now = input.timestamp ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO attachments
           (id, name, path, size, is_image, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name         = excluded.name,
           path         = excluded.path,
           size         = excluded.size,
           is_image     = excluded.is_image,
           last_used_at = excluded.last_used_at`,
      )
      .run(
        input.id,
        input.name,
        input.path,
        Math.max(0, Math.trunc(input.size)),
        input.isImage ? 1 : 0,
        now,
        now,
      );
    const record = this.get(input.id);
    if (!record) throw new Error(`附件索引写入后读取失败：${input.id}`);
    return record;
  }

  /** 刷新附件使用时间（读取时调用，供孤儿清理参考）。 */
  touch(id: string): void {
    this.db.prepare("UPDATE attachments SET last_used_at = ? WHERE id = ?").run(Date.now(), id);
  }

  get(id: string): AttachmentRecord | null {
    const row = this.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as
      | AttachmentRow
      | undefined;
    return row ? toRecord(row) : null;
  }

  /**
   * @description 按最近使用时间倒序列出附件。
   * @param {number} limit - 条数上限
   * @returns {AttachmentRecord[]} 附件列表
   */
  list(limit = 200): AttachmentRecord[] {
    const capped = Math.min(Math.max(limit, 1), LIST_LIMIT_MAX);
    const rows = this.db
      .prepare("SELECT * FROM attachments ORDER BY last_used_at DESC LIMIT ?")
      .all(capped) as unknown as AttachmentRow[];
    return rows.map(toRecord);
  }

  remove(id: string): boolean {
    const result = this.db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /**
   * @description 清掉磁盘上已不存在的条目（附件目录被手工删除或清理过）。
   * @param {(filePath: string) => boolean} exists - 判断路径是否存在
   * @returns {number} 删除的行数
   */
  pruneMissing(exists: (filePath: string) => boolean): number {
    let removed = 0;
    for (const record of this.list(LIST_LIMIT_MAX)) {
      if (exists(record.path)) continue;
      if (this.remove(record.id)) removed += 1;
    }
    return removed;
  }
}

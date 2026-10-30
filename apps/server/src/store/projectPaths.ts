/**
 * 项目目录历史（project_paths 表）：最近使用的目录排最前，最多保留 20 条。
 */
import { normalizeDirectoryPath } from "@cc-heart/open-chat-types";
import type { Database } from "../db/database";

export const PROJECT_PATH_HISTORY_LIMIT = 20;

export class ProjectPathStore {
  constructor(private readonly db: Database) {}

  /**
   * @description 按最近使用时间列出目录历史。
   * @returns {string[]} 目录列表（最多 20 条）
   */
  list(): string[] {
    const rows = this.db
      .prepare("SELECT path FROM project_paths ORDER BY last_used_at DESC, rowid DESC LIMIT ?")
      .all(PROJECT_PATH_HISTORY_LIMIT) as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  /**
   * @description 记住一个目录（已存在则刷新使用时间），并裁剪超出上限的旧记录。
   * @param {string} path - 目录路径
   * @param {number} now - 使用时间
   * @returns {string[]} 更新后的目录历史
   */
  remember(path: string, now = Date.now()): string[] {
    const normalized = normalizeDirectoryPath(path);
    if (!normalized) return this.list();
    this.db
      .prepare(
        `INSERT INTO project_paths (path, last_used_at) VALUES (?, ?)
         ON CONFLICT (path) DO UPDATE SET last_used_at = excluded.last_used_at`,
      )
      .run(normalized, now);
    this.db
      .prepare(
        `DELETE FROM project_paths WHERE path NOT IN (
           SELECT path FROM project_paths ORDER BY last_used_at DESC, rowid DESC LIMIT ?
         )`,
      )
      .run(PROJECT_PATH_HISTORY_LIMIT);
    return this.list();
  }

  /**
   * @description 从历史中移除目录。
   * @param {string} path - 目录路径
   * @returns {string[]} 更新后的目录历史
   */
  forget(path: string): string[] {
    this.db.prepare("DELETE FROM project_paths WHERE path = ?").run(normalizeDirectoryPath(path));
    return this.list();
  }

  /**
   * @description 旧数据导入：目录不在历史中时按给定时间写入。
   * @param {string} path - 目录路径
   * @param {number} lastUsedAt - 使用时间（旧列表按顺序递减生成）
   * @returns {boolean} 实际写入时为 true
   */
  insertIfAbsent(path: string, lastUsedAt: number): boolean {
    const normalized = normalizeDirectoryPath(path);
    if (!normalized) return false;
    const result = this.db
      .prepare("INSERT OR IGNORE INTO project_paths (path, last_used_at) VALUES (?, ?)")
      .run(normalized, lastUsedAt);
    return Number(result.changes) > 0;
  }

  /**
   * @description 统计目录历史条数。
   * @returns {number} 条数
   */
  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM project_paths").get() as { n: number }).n;
  }
}

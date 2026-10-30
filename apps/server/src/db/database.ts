/**
 * 网关 SQLite 连接：基于 Node 内置 `node:sqlite`（零依赖、无需原生编译，
 * esbuild 打包时保持外部 require）。
 *
 * - WAL + NORMAL 同步：单进程本地应用下读写互不阻塞，崩溃不丢已提交事务；
 * - 外键约束开启：任务删除自动解除会话关联、会话删除级联清理 transcript；
 * - 迁移按 `PRAGMA user_version` 逐版本执行，每个版本一个事务。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations";

export type Database = DatabaseSync;

/** 正处于事务中的连接（node:sqlite 旧版本没有 isTransaction，自行记录以支持嵌套调用）。 */
const activeTransactions = new WeakSet<DatabaseSync>();

/**
 * @description 打开（必要时创建）数据库文件并迁移到最新 schema。
 * @param {string} file - 数据库文件路径；":memory:" 用于测试
 * @returns {Database} 已完成迁移、可直接使用的连接
 */
export function openDatabase(file: string): Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(db);
  return db;
}

/**
 * @description 读取当前 schema 版本（PRAGMA user_version）。
 * @param {Database} db - 数据库连接
 * @returns {number} 已应用的迁移数量
 */
export function schemaVersion(db: Database): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

/**
 * @description 依次执行尚未应用的迁移；每个版本在独立事务中完成，失败整体回滚。
 * @param {Database} db - 数据库连接
 * @returns {number} 迁移后的 schema 版本
 */
export function migrate(db: Database): number {
  let version = schemaVersion(db);
  if (version > MIGRATIONS.length) {
    throw new Error(
      `数据库 schema 版本 ${version} 高于当前程序支持的 ${MIGRATIONS.length}，请升级 Open Chat`,
    );
  }
  while (version < MIGRATIONS.length) {
    const next = version + 1;
    transaction(db, () => {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
  return version;
}

/**
 * @description 在事务中执行回调：成功提交、抛错回滚；已在事务中时直接复用外层事务。
 * @param {Database} db - 数据库连接
 * @param {() => T} fn - 事务体（同步函数）
 * @returns {T} 事务体的返回值
 */
export function transaction<T>(db: Database, fn: () => T): T {
  if (activeTransactions.has(db)) return fn();
  db.exec("BEGIN IMMEDIATE");
  activeTransactions.add(db);
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    activeTransactions.delete(db);
  }
}

/**
 * @description 判断错误是否为 SQLite 外键约束失败（引用的任务 / 会话不存在）。
 * @param {unknown} error - 捕获到的异常
 * @returns {boolean} 外键约束失败时为 true
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message);
}

/**
 * @description 解析 JSON 文本列；损坏或类型不符时返回调用方给定的空值，避免单行坏数据拖垮整个列表。
 * @param {unknown} text - 列值
 * @param {T} empty - 解析失败时的返回值
 * @returns {T} 解析结果
 */
export function parseJsonColumn<T extends object>(text: unknown, empty: T): T {
  if (typeof text !== "string" || !text) return empty;
  try {
    const parsed = JSON.parse(text) as unknown;
    const sameShape = Array.isArray(empty)
      ? Array.isArray(parsed)
      : typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    return sameShape ? (parsed as T) : empty;
  } catch {
    return empty;
  }
}

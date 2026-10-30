/**
 * 浏览器旧数据一次性迁移：早期版本把会话、任务、服务商等存在 IndexedDB（库名
 * `open-chat`）与 localStorage。启动时读出全部旧数据提交给网关合并进 SQLite，
 * 成功后删除本地副本——之后浏览器不再保存任何工作区数据。
 *
 * 读取时不会「顺手创建」空数据库：库不存在时在 upgradeneeded 阶段中止打开。
 */
import type { LegacyImportPayload, LegacyImportResult } from "@cc-heart/open-chat-types";
import { workspaceApi } from "./workspaceApi";

const LEGACY_DB_NAME = "open-chat";
const LEGACY_KV_STORE = "app-state";
const LEGACY_TASK_STORE = "tasks";

/** 旧 IndexedDB 键值仓库中的键 → 导入载荷字段。 */
const LEGACY_KV_KEYS: Record<string, keyof LegacyImportPayload> = {
  "chat-state-v1": "chatState",
  "providers-v1": "providers",
  "board-assistant-v1": "boardAssistant",
  "open-chat-project-paths-v1": "projectPaths",
};

/** 旧 localStorage 键 → 导入载荷字段（值为 JSON 时解析，否则按字符串）。 */
const LEGACY_LOCAL_STORAGE_KEYS: Record<string, keyof LegacyImportPayload> = {
  "open-chat-project-paths-v1": "projectPaths",
  "open-chat-agent": "activeAgentId",
  "open-chat-agent-default-models": "agentDefaultModels",
};

/**
 * @description 打开已存在的旧 IndexedDB；库不存在时中止升级事务，避免创建空库。
 * @returns {Promise<IDBDatabase | null>} 数据库连接；不存在或浏览器不支持时为 null
 */
function openExistingLegacyDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/**
 * @description 读取某个对象仓库的全部内容。
 * @param {IDBDatabase} db - 数据库连接
 * @param {string} storeName - 仓库名
 * @param {"all" | "entries"} mode - all：返回值数组；entries：返回键值映射
 * @returns {Promise<unknown>} 仓库内容；仓库不存在时为 undefined
 */
function readStore(db: IDBDatabase, storeName: string, mode: "all" | "entries"): Promise<unknown> {
  if (!db.objectStoreNames.contains(storeName)) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const store = db.transaction(storeName, "readonly").objectStore(storeName);
    if (mode === "all") {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      return;
    }
    const entries: Record<string, unknown> = {};
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(entries);
        return;
      }
      entries[String(cursor.key)] = cursor.value;
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * @description 汇总旧 IndexedDB 中的数据（任务优先取独立仓库，其次取更早的 tasks-v1 键）。
 * @param {IDBDatabase} db - 数据库连接
 * @returns {Promise<LegacyImportPayload>} 导入载荷
 */
async function readLegacyDatabase(db: IDBDatabase): Promise<LegacyImportPayload> {
  const payload: LegacyImportPayload = {};
  const entries = ((await readStore(db, LEGACY_KV_STORE, "entries")) ?? {}) as Record<
    string,
    unknown
  >;
  for (const [key, field] of Object.entries(LEGACY_KV_KEYS)) {
    if (entries[key] !== undefined && entries[key] !== null) payload[field] = entries[key];
  }
  const tasks = await readStore(db, LEGACY_TASK_STORE, "all");
  if (Array.isArray(tasks) && tasks.length > 0) payload.tasks = tasks;
  else if (Array.isArray(entries["tasks-v1"])) payload.tasks = entries["tasks-v1"];
  return payload;
}

/**
 * @description 读取旧 localStorage 键（只补充 IndexedDB 中没有的字段）。
 * @param {LegacyImportPayload} payload - 待补充的载荷（原地修改）
 * @returns {string[]} 实际存在的旧键（导入成功后删除）
 */
function readLegacyLocalStorage(payload: LegacyImportPayload): string[] {
  const found: string[] = [];
  for (const [key, field] of Object.entries(LEGACY_LOCAL_STORAGE_KEYS)) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return found;
    }
    if (raw === null) continue;
    found.push(key);
    if (payload[field] !== undefined) continue;
    try {
      payload[field] = JSON.parse(raw) as unknown;
    } catch {
      payload[field] = raw;
    }
  }
  return found;
}

/**
 * @description 删除旧 IndexedDB 数据库。
 * @returns {Promise<void>} 删除完成（失败时静默，下次启动重试）
 */
function deleteLegacyDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/**
 * @description 把浏览器旧数据迁移到网关（每次启动调用，没有旧数据时立即返回）。
 * @returns {Promise<LegacyImportResult | null>} 导入统计；没有旧数据时为 null
 * @throws {Error} 网关导入失败时抛出，本地数据保持不变以便下次重试
 */
export async function migrateLegacyBrowserData(): Promise<LegacyImportResult | null> {
  const db = await openExistingLegacyDatabase();
  let payload: LegacyImportPayload = {};
  try {
    if (db) payload = await readLegacyDatabase(db);
  } finally {
    db?.close();
  }
  const localKeys = readLegacyLocalStorage(payload);
  if (!db && localKeys.length === 0) return null;

  const result = Object.keys(payload).length > 0 ? await workspaceApi.importLegacy(payload) : null;
  if (db) await deleteLegacyDatabase();
  for (const key of localKeys) localStorage.removeItem(key);
  return result;
}

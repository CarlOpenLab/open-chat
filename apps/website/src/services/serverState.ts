/**
 * 网关状态存取：任务看板 / 会话索引等结构化状态整体存在网关
 * （`~/.cc-hearts-open-code/state/*.json`），浏览器保持无状态。
 *
 * 加载顺序：网关优先；网关可达但无数据时，迁移浏览器 IndexedDB 旧数据
 * 到网关（一次性，随后清掉本地副本）；网关不可达时回退本地副本并告警，
 * 保存时双写（网关失败写本地兜底），保证临时断连不丢数据。
 */
import { API_BASE_URL, GATEWAY_API_KEY } from "./ai";
import { handleGatewayUnauthorized } from "./access";
import {
  deleteLocalValue,
  readAllTasks,
  readLocalValue,
  writeLocalValue,
  writeTaskValue,
  clearAllTasks,
} from "./localDatabase";

export type ServerStateName =
  | "chat-state"
  | "tasks"
  | "task-filters"
  | "project-paths"
  | "providers"
  | "board-assistant";

const headers = () =>
  GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : undefined;

const stateUrl = (name: ServerStateName) => `${API_BASE_URL}/api/state/${name}`;

/** 网关是否可达（网络层）；HTTP 4xx/5xx 视为可达（由上层按语义处理）。 */
async function fetchStateEnvelope(name: ServerStateName): Promise<{
  reachable: boolean;
  found: boolean;
  data: unknown;
}> {
  const response = await fetch(stateUrl(name), { headers: headers() });
  handleGatewayUnauthorized(response);
  if (response.status === 404) {
    const body = (await response.json().catch(() => null)) as { found?: boolean } | null;
    return { reachable: true, found: false, data: body };
  }
  if (!response.ok) return { reachable: true, found: false, data: null };
  const body = (await response.json()) as { found?: boolean; data?: unknown };
  return { reachable: true, found: body.found === true, data: body.data };
}

async function putStateEnvelope(name: ServerStateName, data: unknown): Promise<boolean> {
  const response = await fetch(stateUrl(name), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers() },
    body: JSON.stringify(data ?? null),
  });
  handleGatewayUnauthorized(response);
  return response.ok;
}

/** 从本地旧存储读取迁移源：tasks 同时查 task store 与 legacy kv 键。 */
async function readLegacyLocal(name: ServerStateName): Promise<unknown> {
  try {
    if (name === "tasks") {
      const fromStore = await readAllTasks();
      if (fromStore.length > 0) return fromStore;
      const legacyArray = await readLocalValue<unknown>("tasks-v1");
      return Array.isArray(legacyArray) ? legacyArray : undefined;
    }
    return await readLocalValue<unknown>(LEGACY_KEYS[name]);
  } catch {
    return undefined;
  }
}

const LEGACY_KEYS: Record<Exclude<ServerStateName, "tasks">, string> = {
  "chat-state": "chat-state-v1",
  "task-filters": "task-board-filters-v1",
  "project-paths": "open-chat-project-paths-v1",
  providers: "providers-v1",
  "board-assistant": "board-assistant-v1",
};

/** 迁移成功后清掉本地副本，避免下次启动二次迁移。 */
async function clearLegacyLocal(name: ServerStateName): Promise<void> {
  try {
    if (name === "tasks") {
      await clearAllTasks();
      await deleteLocalValue("tasks-v1");
      return;
    }
    await deleteLocalValue(LEGACY_KEYS[name]);
  } catch {
    // ignore
  }
}

/**
 * 加载状态：网关优先，一次性迁移 IndexedDB 旧数据；网关不可达回退本地。
 * `hasLocalFallback` 为假（本地也没有旧数据）时直接返回 null，不告警。
 */
export async function loadServerState(name: ServerStateName): Promise<unknown> {
  try {
    const envelope = await fetchStateEnvelope(name);
    if (envelope.found) return envelope.data;
    // 网关无数据：尝试一次性迁移浏览器旧数据
    const legacy = await readLegacyLocal(name);
    if (legacy !== undefined && legacy !== null) {
      const migrated = await putStateEnvelope(name, legacy);
      if (migrated) {
        await clearLegacyLocal(name);
        console.info(`[state] migrated ${name} from IndexedDB to gateway`);
      }
      return legacy;
    }
    return null;
  } catch {
    // 网关不可达（LAN 未启动 / 离线）：回退本地副本
    const legacy = await readLegacyLocal(name);
    if (legacy !== undefined && legacy !== null) {
      console.warn(`[state] gateway unreachable, using local fallback for ${name}`);
    }
    return legacy ?? null;
  }
}

/** 保存状态：先写网关；网关失败（不可达/5xx）写本地兜底。 */
export async function saveServerState(name: ServerStateName, data: unknown): Promise<void> {
  try {
    if (await putStateEnvelope(name, data)) return;
  } catch {
    // 网络失败 → 本地兜底
  }
  try {
    if (name === "tasks") {
      const list = Array.isArray(data) ? data : [];
      await clearAllTasks();
      for (const task of list) await writeTaskValue(task as never);
      return;
    }
    await writeLocalValue(LEGACY_KEYS[name], JSON.parse(JSON.stringify(data ?? null)));
  } catch (error) {
    console.error(`[state] failed to persist ${name}:`, error);
  }
}

/** 清除状态：网关与本地兜底副本都清。 */
export async function clearServerState(name: ServerStateName): Promise<void> {
  try {
    await fetch(stateUrl(name), { method: "DELETE", headers: headers() }).catch(() => {});
  } catch {
    // ignore
  }
  await clearLegacyLocal(name);
}

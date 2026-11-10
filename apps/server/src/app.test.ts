/// <reference types="vite-plus/test/globals" />

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createWebAccessControl } from "./access";
import { AgentManager } from "./agentManager";
import { createGatewayApp, type GatewayRuntime } from "./app";
import { defaultAppConfig } from "./config";
import { WorkspaceStore } from "./store/workspace";

describe("gateway HTTP API", () => {
  const access = createWebAccessControl();
  let runtime: GatewayRuntime;
  let server: Server;
  let baseUrl: string;
  let cookie: string;

  /** 带登录 cookie 的 JSON 请求。 */
  const api = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    const response = await fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        Cookie: cookie,
        ...(rest.headers as Record<string, string> | undefined),
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as any) : null };
  };

  beforeAll(async () => {
    const config = defaultAppConfig();
    runtime = {
      config,
      store: WorkspaceStore.open(":memory:"),
      searchProvider: null,
      localChat: null,
      agentManager: new AgentManager({ ...config.acp, agents: [] }, null),
    };
    server = createGatewayApp(runtime, undefined, access).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const login = await fetch(`${baseUrl}/api/access/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: access.password }),
    });
    cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runtime.store.close();
  });

  it("requires the per-start password for /api but keeps access/status public", async () => {
    const anonymous = await fetch(`${baseUrl}/api/conversations`);
    expect(anonymous.status).toBe(401);
    const status = await fetch(`${baseUrl}/api/access/status`);
    expect(await status.json()).toEqual({ authorized: false });
    const wrong = await fetch(`${baseUrl}/api/access/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    expect(wrong.status).toBe(401);
    expect(cookie).toMatch(/^open_chat_access=/);
    expect((await api("/api/access/status")).body).toEqual({ authorized: true });
  });

  it("upserts conversations and returns them in the list", async () => {
    const key = "acp:codex:1760000000000-abc";
    const saved = await api(`/api/conversations/${encodeURIComponent(key)}`, {
      method: "PUT",
      json: { title: "会话", agentId: "codex", updatedAt: 5 },
    });
    expect(saved.body.conversation).toMatchObject({ key, agentId: "codex" });

    const transcript = [{ id: "u1", message: { role: "user", content: "hi" } }];
    await api(`/api/conversations/${encodeURIComponent(key)}/transcript`, {
      method: "PUT",
      json: { messages: transcript },
    });
    expect(
      (await api(`/api/conversations/${encodeURIComponent(key)}/transcript`)).body.messages,
    ).toEqual(transcript);

    await api(`/api/conversations/${encodeURIComponent(key)}/archive`, { method: "POST" });
    expect((await api("/api/conversations")).body.conversations).toEqual([]);
  });

  it("returns masked provider keys only", async () => {
    const plainKey = ["plain", "text", "provider", "key"].join("-");
    const created = await api("/api/providers", {
      method: "POST",
      json: { name: "Demo", baseUrl: "https://example.com/v1", apiKey: plainKey },
    });
    expect(created.status).toBe(201);
    expect(created.body.provider).toMatchObject({
      hasKey: true,
      apiKeyMasked: `${plainKey.slice(0, 4)}…${plainKey.slice(-4)}`,
    });
    const listed = await api("/api/providers");
    expect(JSON.stringify(listed.body)).not.toContain(plainKey);
  });

  it("stores preferences, project path history and imports legacy browser data", async () => {
    const preferences = await api("/api/preferences", {
      method: "PATCH",
      json: { activeAgentId: "claude" },
    });
    expect(preferences.body.preferences.activeAgentId).toBe("claude");
    expect((await api("/api/preferences", { method: "PATCH", json: { nope: 1 } })).status).toBe(
      400,
    );

    const remembered = await api("/api/project-path/history", {
      method: "POST",
      json: { path: "/work/repo/" },
    });
    expect(remembered.body.paths).toEqual(["/work/repo"]);
    const forgotten = await api(
      `/api/project-path/history?path=${encodeURIComponent("/work/repo")}`,
      {
        method: "DELETE",
      },
    );
    expect(forgotten.body.paths).toEqual([]);

    const imported = await api("/api/workspace/import-legacy", {
      method: "POST",
      json: { projectPaths: ["/legacy"] },
    });
    expect(imported.body.imported).toMatchObject({ projectPaths: 1 });

    const info = await api("/api/workspace/info");
    expect(info.body).toMatchObject({ databasePath: ":memory:", schemaVersion: 1 });
  });

  it("answers unknown API routes and malformed JSON with JSON errors", async () => {
    const missing = await api("/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");

    const malformed = await fetch(`${baseUrl}/api/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "{oops",
    });
    expect(malformed.status).toBe(400);
    const error = (await malformed.json()) as { error: { message: string } };
    expect(error.error.message).toContain("JSON");
  });
});

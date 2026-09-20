/// <reference types="vite-plus/test/globals" />

vi.mock("antdv-next", () => ({
  message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("../../services/serverState", () => ({
  loadServerState: vi.fn(async () => undefined),
  saveServerState: vi.fn(async () => undefined),
}));

import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import type { ShallowRef } from "vue";
import { shallowRef } from "vue";
import { message } from "antdv-next";
import { loadServerState, saveServerState } from "../../services/serverState";
import type { OpenChatConversation } from "../useChatPersistence";
import { useProjectPath } from "./useProjectPath";

/** 依赖桩：running 控制 isConversationRunning，其余用 spy 观察调用。 */
function makeDeps(running = false) {
  const conversationList: ShallowRef<OpenChatConversation[]> = shallowRef<OpenChatConversation[]>(
    [],
  );
  const currentConversationKey: ShallowRef<string> = shallowRef<string>("");
  return {
    conversationList,
    currentConversationKey,
    isConversationRunning: () => running,
    schedulePersist: vi.fn(),
    refreshAcpSession: vi.fn(),
    forgetFailedHistoryRefresh: vi.fn(),
  };
}

const conversation = (key: string, messages: DefaultMessageInfo<XModelMessage>[] = []) =>
  ({ key, label: "会话", messages }) as OpenChatConversation;

describe("useProjectPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadServerState).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("归一化路径：去尾部分隔符，等于默认目录时视为未选择", () => {
    const project = useProjectPath(makeDeps());
    expect(project.normalizeProjectPath("/a/b/")).toBe("/a/b");
    expect(project.normalizeProjectPath("/")).toBe("/");
    expect(project.normalizeProjectPath(undefined)).toBe("");

    project.defaultProjectPath.value = "/a/b";
    expect(project.normalizeProjectPath("/a/b/")).toBe("");
    expect(project.normalizeProjectPath("/a/c")).toBe("/a/c");
  });

  it("记住路径：最近使用的排最前、去重、上限 20 条，默认目录不入历史", () => {
    const project = useProjectPath(makeDeps());
    for (let index = 0; index < 25; index += 1) project.rememberProjectPath(`/p/${index}`);

    expect(project.projectPathHistory.value).toHaveLength(20);
    expect(project.projectPathHistory.value[0]).toBe("/p/24");
    expect(saveServerState).toHaveBeenLastCalledWith(
      "project-paths",
      project.projectPathHistory.value,
    );

    project.rememberProjectPath("/p/10/");
    expect(project.projectPathHistory.value[0]).toBe("/p/10");
    expect(project.projectPathHistory.value.filter((item) => item === "/p/10")).toHaveLength(1);
    expect(project.projectPathHistory.value).toHaveLength(20);

    project.defaultProjectPath.value = "/p/10";
    project.rememberProjectPath("/p/10");
    expect(project.projectPathHistory.value).toHaveLength(20);
    expect(project.projectPathHistory.value.filter((item) => item === "/p/10")).toHaveLength(1);
  });

  it("删除路径按归一化结果匹配，当前目录补位到最前", () => {
    const project = useProjectPath(makeDeps());
    project.projectPathHistory.value = ["/p/1", "/p/2"];
    project.projectPath.value = "/p/2/";

    expect(project.projectPathOptions.value).toEqual(["/p/2", "/p/1"]);
    project.forgetProjectPath("/p/2/");
    expect(project.projectPathHistory.value).toEqual(["/p/1"]);
    expect(project.projectPathOptions.value).toEqual(["/p/2", "/p/1"]);
  });

  it("会话运行中拒绝切换目录，且不触发持久化与 ACP 重拉", () => {
    const deps = makeDeps(true);
    deps.conversationList.value = [conversation("c1")];
    deps.currentConversationKey.value = "c1";
    const project = useProjectPath(deps);

    project.handleProjectPathChange("/new/");

    expect(project.projectPath.value).toBe("");
    expect(deps.schedulePersist).not.toHaveBeenCalled();
    expect(deps.refreshAcpSession).not.toHaveBeenCalled();
    expect(message.warning).toHaveBeenCalled();
  });

  it("切换目录写入会话、记住路径、失效失败锁并强制重拉会话", () => {
    const deps = makeDeps();
    deps.conversationList.value = [conversation("c1")];
    deps.currentConversationKey.value = "c1";
    const project = useProjectPath(deps);

    project.handleProjectPathChange("/repo/");

    expect(project.projectPath.value).toBe("/repo");
    expect(deps.conversationList.value[0].projectPath).toBe("/repo");
    expect(project.projectPathHistory.value).toEqual(["/repo"]);
    expect(deps.schedulePersist).toHaveBeenCalledTimes(1);
    expect(deps.forgetFailedHistoryRefresh).toHaveBeenCalledWith("c1");
    expect(deps.refreshAcpSession).toHaveBeenCalledWith(true);
  });

  it("草稿态切换目录同步草稿路径，删除当前目录时回落到空路径", () => {
    const deps = makeDeps();
    const project = useProjectPath(deps);

    project.handleProjectPathChange("/draft/");
    expect(project.draftProjectPath.value).toBe("/draft");

    project.handleProjectPathRemove("/draft");
    expect(project.projectPath.value).toBe("");
    expect(project.projectPathHistory.value).toEqual([]);
  });

  it("网关返回旧 Record<agentId,string[]> 时合并去重为全局历史", async () => {
    vi.stubGlobal("window", {});
    vi.mocked(loadServerState).mockResolvedValue({
      claude: ["/a/", "/b"],
      codex: ["/b", ""],
    });
    const project = useProjectPath(makeDeps());

    project.loadProjectPathHistory();

    await vi.waitFor(() => expect(project.projectPathHistory.value.length).toBe(2));
    expect(project.projectPathHistory.value).toEqual(["/a", "/b"]);
  });

  it("网关无数据时一次性迁移 localStorage 旧副本并清掉本地键", async () => {
    const store = new Map<string, string>([
      ["open-chat-project-paths-v1", JSON.stringify(["/legacy/"])],
    ]);
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
    });
    vi.mocked(loadServerState).mockResolvedValue(null);
    const project = useProjectPath(makeDeps());

    project.loadProjectPathHistory();

    await vi.waitFor(() => expect(store.size).toBe(0));
    const payload = vi.mocked(saveServerState).mock.calls[0]?.[1] as string[];
    expect(saveServerState).toHaveBeenCalledWith("project-paths", ["/legacy/"]);
    expect(payload.map((item) => item.replace(/\/+$/u, ""))).toEqual(["/legacy"]);
  });
});

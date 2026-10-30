/// <reference types="vite-plus/test/globals" />

vi.mock("antdv-next", () => ({
  message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("../../services/workspaceApi", () => ({
  projectPathsApi: {
    list: vi.fn(async () => []),
    remember: vi.fn(),
    forget: vi.fn(),
  },
}));

import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import type { ShallowRef } from "vue";
import { shallowRef } from "vue";
import { message } from "antdv-next";
import { projectPathsApi } from "../../services/workspaceApi";
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

/** 网关记住 / 删除目录时永不返回（只验证本地乐观更新）。 */
const pending = () => new Promise<string[]>(() => {});

describe("useProjectPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectPathsApi.list).mockResolvedValue([]);
    vi.mocked(projectPathsApi.remember).mockImplementation(pending);
    vi.mocked(projectPathsApi.forget).mockImplementation(pending);
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

  it("记住路径：本地最近使用的排最前、去重、上限 20 条，并写入网关", () => {
    const project = useProjectPath(makeDeps());
    for (let index = 0; index < 25; index += 1) project.rememberProjectPath(`/p/${index}`);

    expect(project.projectPathHistory.value).toHaveLength(20);
    expect(project.projectPathHistory.value[0]).toBe("/p/24");
    expect(projectPathsApi.remember).toHaveBeenLastCalledWith("/p/24");

    project.rememberProjectPath("/p/10/");
    expect(project.projectPathHistory.value[0]).toBe("/p/10");
    expect(project.projectPathHistory.value.filter((item) => item === "/p/10")).toHaveLength(1);
    expect(project.projectPathHistory.value).toHaveLength(20);

    project.defaultProjectPath.value = "/p/10";
    project.rememberProjectPath("/p/10");
    expect(projectPathsApi.remember).toHaveBeenLastCalledWith("/p/10");
    expect(projectPathsApi.remember).toHaveBeenCalledTimes(26);
  });

  it("网关返回的列表覆盖本地历史，并过滤默认目录", async () => {
    vi.mocked(projectPathsApi.remember).mockResolvedValue(["/server/x", "/p/1", "/default"]);
    const project = useProjectPath(makeDeps());
    project.defaultProjectPath.value = "/default";

    project.rememberProjectPath("/p/1");

    await vi.waitFor(() => expect(project.projectPathHistory.value).toEqual(["/server/x", "/p/1"]));
  });

  it("删除路径按归一化结果匹配，当前目录补位到最前", () => {
    const project = useProjectPath(makeDeps());
    project.projectPathHistory.value = ["/p/1", "/p/2"];
    project.projectPath.value = "/p/2/";

    expect(project.projectPathOptions.value).toEqual(["/p/2", "/p/1"]);
    project.forgetProjectPath("/p/2/");
    expect(project.projectPathHistory.value).toEqual(["/p/1"]);
    expect(projectPathsApi.forget).toHaveBeenCalledWith("/p/2");
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

  it("从网关加载目录历史", async () => {
    vi.mocked(projectPathsApi.list).mockResolvedValue(["/a/", "/b", "/a"]);
    const project = useProjectPath(makeDeps());

    await project.loadProjectPathHistory();

    expect(project.projectPathHistory.value).toEqual(["/a", "/b"]);
  });
});

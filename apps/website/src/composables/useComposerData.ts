import { message } from "antdv-next";
import { ref, watch, type Ref } from "vue";
import {
  aiService,
  type GitWorkspaceInfo,
  type SkillsIndex,
  type UploadedAttachment,
} from "../services/ai";

/** 输入框中的待发送附件：上传完成前本地预览，上传后携带持久引用。 */
export interface StagedAttachment extends UploadedAttachment {
  /** 去重键：name + size + lastModified。 */
  sourceKey: string;
  /** 本地预览 URL（blob:），发送前有效。 */
  previewUrl: string;
  uploading: boolean;
  error?: string;
}

export interface UseComposerDataDeps {
  projectPath: Ref<string>;
  loading: Ref<boolean>;
  /** Agent 会话才拉取 skills（API 直连会话没有 CLI 去解析 "/skill"）。 */
  agentMode: Ref<boolean>;
  /**
   * 目录选择器选定后的落点：必须复用上层 handleProjectPathChange
   *（含 rememberProjectPath / refreshAcpSession），不得直接改 projectPath ref。
   */
  onProjectPathChange: (value: string) => void;
}

export interface UseComposerData {
  gitWorkspace: Ref<GitWorkspaceInfo | null>;
  /** 分支切换进行中（原 gitBranchSwitching）。 */
  gitWorkspaceBusy: Ref<boolean>;
  /** 系统目录选择器进行中。 */
  projectPathPicking: Ref<boolean>;
  skills: Ref<SkillsIndex>;
  stagedAttachments: Ref<StagedAttachment[]>;
  handlePickProjectPath: () => Promise<void>;
  /** Git 菜单打开等 UI 时机的手动刷新（watch 两路已内置）。 */
  handleGitWorkspaceRefresh: () => void;
  handleGitBranchSwitch: (branch: string) => Promise<void>;
  handleAttachmentsUpload: (files: File[]) => void;
  /** v-model:attachments 的落点：diff 出被移除项并 revoke 其 blob URL。 */
  handleAttachmentsChange: (next: StagedAttachment[]) => void;
  /** 提交成功后清空附件（全量 revoke blob URL）。 */
  clearAttachments: () => void;
  /** 组件树卸载时兜底 revoke 残余 blob URL。 */
  dispose: () => void;
}

/**
 * ChatInput 的业务数据层：Git 工作区 / skills / 附件上传三类副作用与
 * 竞态守卫集中在这里，组件只消费受控数据、emit 意图（见重构计划）。
 * toast 文案与静默降级行为与原 ChatInput 内嵌实现逐字保持一致。
 */
export function useComposerData(deps: UseComposerDataDeps): UseComposerData {
  // ============ 系统目录选择器 ============

  const projectPathPicking = ref(false);

  const handlePickProjectPath = async () => {
    if (projectPathPicking.value) return;
    projectPathPicking.value = true;
    try {
      const result = await aiService.pickProjectPath();
      if (result.path) {
        deps.onProjectPathChange(result.path);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "系统目录选择器不可用");
    } finally {
      projectPathPicking.value = false;
    }
  };

  // ============ Git 工作区 ============

  const gitWorkspace = ref<GitWorkspaceInfo | null>(null);
  const gitWorkspacePath = ref("");
  const gitWorkspaceBusy = ref(false);
  let gitWorkspaceSequence = 0;

  const loadGitWorkspace = async () => {
    const projectPath = deps.projectPath.value.trim();
    const sequence = ++gitWorkspaceSequence;
    if (!projectPath) {
      gitWorkspace.value = null;
      gitWorkspacePath.value = "";
      return;
    }
    if (gitWorkspacePath.value !== projectPath) gitWorkspace.value = null;
    try {
      const workspace = await aiService.getGitWorkspace(projectPath);
      if (sequence === gitWorkspaceSequence && projectPath === deps.projectPath.value.trim()) {
        gitWorkspace.value = workspace;
        gitWorkspacePath.value = projectPath;
      }
    } catch (error) {
      if (sequence === gitWorkspaceSequence) {
        message.error(error instanceof Error ? error.message : "Git 状态读取失败");
      }
    }
  };

  watch(
    () => deps.projectPath.value,
    () => void loadGitWorkspace(),
    { immediate: true },
  );

  watch(
    () => deps.loading.value,
    (loading, wasLoading) => {
      if (wasLoading && !loading && deps.projectPath.value.trim()) void loadGitWorkspace();
    },
  );

  const handleGitWorkspaceRefresh = () => {
    if (!deps.loading.value && deps.projectPath.value.trim()) void loadGitWorkspace();
  };

  const handleGitBranchSwitch = async (branch: string) => {
    const projectPath = deps.projectPath.value.trim();
    if (!projectPath || gitWorkspaceBusy.value || branch === gitWorkspace.value?.currentBranch)
      return;
    gitWorkspaceBusy.value = true;
    try {
      gitWorkspace.value = await aiService.switchGitBranch(projectPath, branch);
      message.success(`已切换到 ${branch}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Git 分支切换失败");
    } finally {
      gitWorkspaceBusy.value = false;
    }
  };

  // ============ Skills（斜杠建议数据源） ============

  const skills = ref<SkillsIndex>({ project: [], global: [] });
  let skillsSequence = 0;

  const loadSkills = async (path: string) => {
    const sequence = ++skillsSequence;
    try {
      const result = await aiService.getSkills(path);
      if (sequence === skillsSequence) skills.value = result;
    } catch {
      // skills 只是 suggestion 增强，拉取失败静默降级为仅内置指令。
      if (sequence === skillsSequence) skills.value = { project: [], global: [] };
    }
  };

  watch(
    () => [deps.agentMode.value, deps.projectPath.value] as const,
    ([agentMode, path]) => {
      if (!agentMode) {
        skillsSequence += 1;
        skills.value = { project: [], global: [] };
        return;
      }
      void loadSkills(path);
    },
    { immediate: true },
  );

  // ============ 附件（图片粘贴 / 拖拽 / 选择） ============
  // blob URL 生命周期集中在本 composable：diff revoke（移除）、
  // 全量 revoke（clear）、dispose 兜底；组件只 emit update:attachments。

  const stagedAttachments = ref<StagedAttachment[]>([]);

  const revokePreview = (entry: StagedAttachment) => {
    if (entry.previewUrl.startsWith("blob:")) URL.revokeObjectURL(entry.previewUrl);
  };

  /** 把 File 列表上传到网关并加入预览行；非图片忽略。 */
  const handleAttachmentsUpload = (files: File[]) => {
    void (async () => {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const sourceKey = `${file.name}:${file.size}:${file.lastModified}`;
        if (stagedAttachments.value.some((entry) => entry.sourceKey === sourceKey)) continue;
        const previewUrl = URL.createObjectURL(file);
        const entry: StagedAttachment = {
          sourceKey,
          reference: "",
          name: file.name,
          isImage: true,
          previewUrl,
          uploading: true,
        };
        stagedAttachments.value.push(entry);
        try {
          const uploaded = await aiService.uploadAttachment(file);
          entry.reference = uploaded.reference;
          entry.name = uploaded.name;
          // The input only accepts image MIME types. Keep the client-side image
          // flag even when a filename has no extension and the gateway cannot
          // infer it from the name alone.
          entry.isImage = true;
          entry.uploading = false;
          stagedAttachments.value = [...stagedAttachments.value];
        } catch (error) {
          entry.uploading = false;
          entry.error = error instanceof Error ? error.message : "上传失败";
          stagedAttachments.value = [...stagedAttachments.value];
        }
      }
    })();
  };

  /** v-model 落点：与旧数组 diff，被移除项的 blob URL 在这里 revoke。 */
  const handleAttachmentsChange = (next: StagedAttachment[]) => {
    const nextKeys = new Set(next.map((entry) => entry.sourceKey));
    for (const entry of stagedAttachments.value) {
      if (!nextKeys.has(entry.sourceKey)) revokePreview(entry);
    }
    stagedAttachments.value = next;
  };

  const clearAttachments = () => {
    for (const entry of stagedAttachments.value) revokePreview(entry);
    stagedAttachments.value = [];
  };

  const dispose = () => {
    for (const entry of stagedAttachments.value) revokePreview(entry);
  };

  return {
    gitWorkspace,
    gitWorkspaceBusy,
    projectPathPicking,
    skills,
    stagedAttachments,
    handlePickProjectPath,
    handleGitWorkspaceRefresh,
    handleGitBranchSwitch,
    handleAttachmentsUpload,
    handleAttachmentsChange,
    clearAttachments,
    dispose,
  };
}

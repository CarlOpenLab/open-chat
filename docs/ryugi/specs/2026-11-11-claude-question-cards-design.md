# Claude 问答卡片与 ACP 审批卡片

日期：2026-11-11
状态：已批准（决策来自 `.ryugi/artifacts/document/claude-question-cards` 第 1 轮，六项均接受建议 A）

## 目标

1. ACP 会话收到 `chat_permission` 时，输入区上方出现可操作的“需要授权”卡片（允许一次 / 始终允许 / 拒绝）。
2. Claude 的 `AskUserQuestion` 在 open-chat 中呈现为内嵌问答卡片：单选、多选、每题自由输入、多题一次提交、取消；答案回传给 Agent。
3. “有监督 / 自动 / 完全访问”选择器对 Claude 真正生效，不再被 `~/.claude/settings.json` 的 `permissions.defaultMode` 静默吞掉。
4. 未回答的问题跟随回合生命周期：刷新、多标签重连后仍可恢复；回答、取消或停止回合后消失。

## 非目标

- 不替其他 Agent（codex/pi/omp/opencode）新增问答 UI；elicitation 作为通用 ACP 能力实现，但只验证 Claude。
- 不改动 Claude Code CLI 自身的交互式终端行为。
- 不持久化问答内容到会话索引（只在服务端内存与 SSE 缓冲中保留）。

## 已定决策

| #   | 决策                                                                                                              | 来源           |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | 桥接切到 `@agentclientprotocol/claude-agent-acp@0.106.0`，锁版本，`CLAUDE_AGENT_ACP_PROTOCOL=v1`；先 spike 兼容性 | 用户接受建议 A |
| 2   | 问答卡片内嵌在对话流末尾（当前回合的问题位置），不放在输入框上方                                                  | 用户接受建议 A |
| 3   | 完整表单能力：单选 / 多选 / 每题“其他” / 多题一次提交 / 取消                                                      | 用户接受建议 A |
| 4   | 直接在 `vendor/acp-hub` 子模块实现 elicitation，并提交到 acp-hub 仓库，再更新 open-chat 子模块指针                | 用户接受建议 A |
| 5   | 网关按 UI 权限策略同步 ACP 会话模式（supervised→default，auto→acceptEdits，full→bypassPermissions）               | 用户接受建议 A |
| 6   | 未回答问题跟回合走，刷新/多标签可恢复；不设 5 分钟超时                                                            | 用户接受建议 A |

## 架构与数据流

```
Claude CLI
  ↕ ACP (stdio, protocol v1)
claude-agent-acp 0.106
  ↕ elicitation/create / session/request_permission
acp-hub core (vendor/acp-hub)
  ↕ SessionEvent elicitation_request
open-chat server /api/chat/completions SSE
  ↕ custom event chat_question / chat_permission
browser WorkspacePage
  └─ pendingQuestion / pendingPermission → 内嵌卡片
```

### acp-hub core

- `AdapterOptions.clientCapabilities` 增加 `elicitation: { form: {} }` 透传；`connection.ts` 的 `initialize` 默认声明 form elicitation。
- `#clientHandler` 增加 `createElicitation`：把 `CreateElicitationRequest` 转成 `SessionEvent` `{ type: 'elicitation_request', requestId, sessionId, mode, message, requestedSchema }`，挂起 Promise，等待 `AgentSession.respondElicitation(requestId, { action, content })`。
- `AgentSession` 增加 `respondElicitation`；会话结束/取消时对所有挂起请求回 `cancel`。
- 事件类型与导出补到 `events.ts` / `index.ts`，`adapter.d.ts` 同步。
- 构建 `vendor/acp-hub` 各包（`pnpm --filter '@cc-heart/acp-hub-*' run build`）。

### open-chat server

- `config.ts`：Claude agent 的 `command/args` 改为 `npx -y @agentclientprotocol/claude-agent-acp@0.106.0`，新增 `env` 字段承载 `CLAUDE_AGENT_ACP_PROTOCOL=v1`。
- `acpManager.ts`：
  - 订阅新的 `elicitation_request` 会话事件：生成 `questionId`，存入 `pendingQuestions`，通过 `emitCustom(sessionId, run.response, "chat_question", payload)` 推送；payload 含 `id/version/agentId/message/requestedSchema`。
  - 新增 `respondQuestion(questionId, { action, content })`；回合结束/取消/超时时清理并回 `cancel`。
  - `runTurn` 开始前按 `permissionMode` 调用 `session.acpSession.setMode?.(...)`（mapping 见决策 5），再进入 prompt；`handlePermission` 的网关级自动审批保留为兜底。
  - 问题不设独立超时；回合取消/结束时统一取消。
- `routes/chat.ts`：新增 `POST /api/chat/question`，body `{ agentId, questionId, action: 'accept'|'decline'|'cancel', content?: Record<string, unknown> }`；校验后调用 `agentManager.respondQuestion`。
- SSE 事件名 `chat_question`，与 `chat_permission` 同级；写入会话总线缓冲，刷新时随快照重放。

### website

- `WorkspacePage.vue`：
  - 新增 `pendingQuestions = reactive(new Map<string, QuestionRequest>())` 与 `pendingQuestion` computed。
  - `handleAcpStreamEvent` 增加 `chat_question` / `chat_permission` 分支：前者写入 `pendingQuestions`（按当前会话 key），后者写入 `pendingPermissions`；两条都不再落到全局 provider。
  - `handleQuestionResponse` POST `/api/chat/question`；成功后删除本地 pending。
  - 回合结束（`finalizeSessionRun` / 流结束）清理该会话的 pending question/permission。
- 新增 `QuestionCard.vue`：读取 elicitation schema，渲染：
  - `oneOf` 单选（标题 + 描述 + `_meta._claude/askUserQuestionOption.preview` 可选）
  - `anyOf` 多选
  - 每题自由输入框（schema 中的 `question_<n>_custom`）
  - 提交 / 跳过 / 取消。
  - 提交时按 schema 字段名组装 `content`。
- 卡片位置：`ConversationPanel` 消息流末尾、最后一条 assistant 消息之后；有 pending question 时自动滚动可见。
- 权限卡修复：ACP 分支的 `chat_permission` 不再被丢弃，复用现有 `PermissionRequestPanel`。

## 兼容性与风险

- **桥接大版本跳跃（0.16.2 → 0.106.0）**：先 spike：临时启动第二个网关（`OPEN_CHAT_DATA_DIR` 隔离、独立端口），用新桥接跑一轮普通对话、一次工具调用、一次 AskUserQuestion，确认协议 v1 下日历/模型/模式配置不回归。
- **acp-hub 子模块**：改动属于独立仓库；实现并测试后单独提交，open-chat 只更新子模块指针。若推送权限不允许，退回本地 patch 并在 spec 记录。
- **全局 bypassPermissions**：`setMode` 是否压过设置需要 spike 验证；若 CLI 仍不询问，网关层按 UI 策略自行拦截并向前端发 `chat_permission` 作为兜底（不改用户全局设置）。
- **并发会话**：`chat_question` 按会话总线隔离；前端只展示当前会话的 pending。

## 实施顺序

1. Part 1：ACP 权限卡接线 + 回归测试（本仓库，小改动）。
2. Spike A：新桥接 × 现有 acp-hub（独立网关实例）。
3. acp-hub elicitation 支持 + 单测。
4. Server `chat_question` 事件与回复接口 + 单测。
5. 前端问答卡片 + 权限卡修复 + 组件/逻辑测试。
6. Spike B：权限模式 setMode 是否生效；必要时加网关层兜底。
7. 端到端验证：真实 Claude 会话提一个问题，选择答案，确认 Agent 收到。

## 验证

- `vp check`、`vp test` 全绿。
- 隔离环境的端到端：提问 → 卡片出现 → 选择 → Agent 继续；刷新后未回答的问题仍在。
- 有监督模式：Claude 执行 Bash 前出现审批卡；允许后继续，拒绝后 Agent 收到拒绝。
- 用户正在运行的开发服务器不被重启；所有验证在独立端口/数据目录完成。

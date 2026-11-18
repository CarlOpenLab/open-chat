# Changelog

## 0.1.0

- 重写：Go（mygo）+ Vue 3 + antdv-next / @antdv-next/x 的桌面工作台，旧 Express + Vite 双进程架构废弃。
- 通过 `@cc-heart/acp-hub` 驱动 Claude Code / Codex / pi / Oh My Pi 与任意自定义 ACP agent。
- 一个对话一个 ACP session；重开走 `session/load` 续上下文，续不上会明确提示。
- 消息流：思考、计划、工具调用（含 diff / 终端输出）、权限请求卡片、流式 markdown、代码高亮、表格。
- 会话落盘（原子写 + 流式合并），侧栏分段（置顶/今天/昨天/近 7 天/更早），搜索、重命名、置顶、删除。
- 权限请求、停止（`session/cancel`）、模式切换、模型/思考强度切换、斜杠命令。
- `open-chat serve`：同一套 UI 走 HTTP + SSE，带一次性 token。
- 内置 Demo Agent（开发构建默认开启），无需安装任何 agent 即可试用。
- 登录 shell 环境探测：从 Dock / 桌面图标启动也能找到 node、claude、codex。
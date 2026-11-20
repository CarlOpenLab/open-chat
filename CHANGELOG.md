# Changelog

## 0.0.3

- 自动更新：接入 mygo updater，每日后台检查新版本，发现后弹出更新窗口（发布说明、安装、稍后、跳过），下载校验签名后原地替换，重启即生效。
- macOS 菜单栏新增「Check for Updates…」；Windows / Linux 在设置 → 偏好里新增「检查更新」按钮。
- 发布：推送 `v0.0.3` 标签即由 GitHub Actions 构建 macOS dmg、Windows 安装包、Linux deb / rpm / tar.gz，连同签名更新清单与增量包一起发布到该标签的 Release。
- 版本号改为从 `mygo.config.ts` / `package.json` 单点读取，界面显示构建时链接的版本。

## 0.0.2

- 设置应用图标（Dock 与安装包）。
- 输入法回车不再误发送；流式光标只保留在最后一段。
- 修复 Windows 标题栏高度与窗口控制按钮；修复 PATH 大小写匹配与 mise 等 Node 路径探测。
- 模型选择器打开时按需探测 Agent 的可用模型，超时更久并直接展示失败原因。
- Pi 改为经 `pi-acp` 桥接启动，修复 `--mode acp` 报错。
- 发布工作流：Windows 改用原生 runner，补齐 Linux 构建与产物收集。

## 0.0.1

- 重写：Go（mygo）+ Vue 3 + antdv-next / @antdv-next/x 的桌面工作台，旧 Express + Vite 双进程架构废弃。
- 通过 `@cc-heart/acp-hub` 驱动 Claude Code / Codex / pi / Oh My Pi 与任意自定义 ACP agent。
- 一个对话一个 ACP session；重开走 `session/load` 续上下文，续不上会明确提示。
- 消息流：思考、计划、工具调用（含 diff / 终端输出）、权限请求卡片、流式 markdown、代码高亮、表格。
- 会话落盘（原子写 + 流式合并），侧栏分段（置顶/今天/昨天/近 7 天/更早），搜索、重命名、置顶、删除。
- 权限请求、停止（`session/cancel`）、模式切换、模型/思考强度切换、斜杠命令。
- `open-chat serve`：同一套 UI 走 HTTP + SSE，带一次性 token。
- 内置 Demo Agent（开发构建默认开启），无需安装任何 agent 即可试用。
- 登录 shell 环境探测：从 Dock / 桌面图标启动也能找到 node、claude、codex。
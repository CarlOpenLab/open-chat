# Changelog

## 0.0.10

- 主题与外观：设置新增「主题」标签页，支持纯色背景模式，优化深浅色 Switch 配色。
- Agent：新增 OpenCode ACP agent 支持。
- Worktree：优化基准分支选择、分支新建与删除确认，状态提示移入输入栏，修复 Checkbox 配色与空会话问题。
- 连接体验：新对话连接中的提示改为纯文字，去掉前面的 loading icon。
- 发布：Release 工作流在 GitHub API 5xx 时自动重试，并支持手动重建指定标签。

## 0.0.9

- Git Worktree 隔离：新对话输入框底部栏支持一键开启 Worktree 隔离，通过 Popover 选择自动分支、自定义分支名或复用已有 Worktree，并自动按 `.worktreeinclude` 同步本地忽略文件；对话顶栏胶囊可查看未提交变更，支持压缩合入（Squash）或保留提交合入主分支，并可一键清理 Worktree 与分支。
- 工作区文件树：修复右键菜单无法定位节点的问题，新增右键新建文件、新建文件夹、重命名与删除。
- 侧栏会话管理：支持会话多选与批量归档、批量删除；修复头像上传及危险操作图标颜色。
- 体验与修复：修复原生 CLI（CodeBuddy / Qoder 等）工作目录漂移与 CodeBuddy 地区配置同步；强停时清理卡死的 agent 进程并加固取消逻辑；修复输入法合成期输入框渲染抖动与全局输入框聚焦双边框问题；优化工具链连接线对比度与新会话目录锁定逻辑；CodeBuddy 改用 LobeHub 官方图标。

## 0.0.8

- 新 Agent：接入 CodeBuddy 与 Qoder CLI（ACP 预设、品牌图标与更新源）；模型选择器展示倍率徽章，会话模型选择落盘并在重连后自动恢复。
- 工作区：支持基于流式 HTTP 的图片、SVG、Markdown、PDF 及音视频预览；面板宽度按会话记忆、文件树 Git 状态着色、工具行悬停与窄屏布局优化；组件样式全量迁移至 UnoCSS。
- 消息渲染：思考过程改用 XMarkdown 渲染；侧栏会话菜单悬停显示、头像菜单优化；移除内置 Demo Agent。
- 修复：Windows 下 `file://` 盘符链接不再误判为 UNC 路径；macOS WKWebView 中 xterm.js 快速输入与 IME 丢字；mise 安装的 Qoder 识别与自动升级。

## 0.0.7

- Skills 与斜杠命令：输入 `/` 直接在输入框上方展开堆叠卡片托盘，支持项目 / 全局 / 命令筛选与实时过滤，可用 ←→↑↓、Tab、Enter、Esc 完整键盘操作；选中的 Skill 以胶囊标签固定在输入框内，回车直接发送 `/skill`。
- 长会话性能：默认只渲染最近 10 轮消息，向上可「展开更早的 N 轮」或一键全部展开；思考块与工具详情在首次展开时才挂载 DOM；轮次启用 `content-visibility`；切换会话先完成绘制再连接 ACP；重复的会话加载请求会合并。
- 文件直达：消息中的本地文件链接、diff 头部的文件名、终端里的路径，点击即在右侧工作区文件树定位并打开；支持 `file://`、绝对路径、`~/`、相对路径与 `:line:col` 后缀，工作区外的路径仍交由系统文件管理器；网页链接在安装版交给默认浏览器，浏览器模式新标签页打开。
- Provider：新增「刷新模型」按钮，外部新增的模型（npm 新装 agent、dsh profile 等）无需重启即可刷新出现；新增 DeepSeek Harness（dsh，`--profile acp`）预设；权限自动放行不再闪确认卡片。
- 终端：按键输入改为 FIFO 队列写入 PTY，快速连续打字不再吞字或乱序；PTY 输出合并推送，终端重绘风暴不再拖慢输入。
- 侧栏：展开 / 收起改为整栏滑出过渡，会话悬停时菜单按钮覆盖时间与状态徽标，不再挤动标题。
- 应用图标去白底，改为透明背景 + 细白描边（Windows 深色任务栏可读）。
- 内部：移除 acp-hub 子模块，构建直接使用 npm 上的 `@cc-heart` 0.0.1。

## 0.0.6

- Windows 修复：新建/切换会话不再弹出三个一闪而过的控制台窗口（git 子进程漏了 `CREATE_NO_WINDOW`）。
- Windows 修复：Agent 更新页此前全部显示「跳过」——现在能正确识别 mise 安装（数据目录取 `%LOCALAPPDATA%\mise`、支持 registry 短名 claude/codex/opencode/pi）以及 npm/pnpm/bun 全局安装（Windows 的全局 shim 是普通文件而非 symlink，需把 bin 目录算进安装根）。

## 0.0.5

- 工作区面板：右侧新增可拖拽宽度的工作区面板（文件树 + 内置终端），文件树采用离线 Catppuccin 图标主题，内置 CodeMirror 6 实时语法高亮编辑器（支持直接编辑、`⌘S`/`Ctrl+S` 保存、撤回与未保存提醒）。
- 权限模式实时同步：底部「每次确认 / 自动批准 / 完全访问」下拉真正映射到 Claude Code、Codex 等 Agent 的 ACP `session/set_mode` / `mode` 配置项，并支持对已连接会话实时热更新 `autoAllow`。
- 底部三合一堆叠卡片：权限确认面板从消息列表迁移到底部输入框上方，与待发消息队列、文件附件统一为可点击切换的堆叠卡片；待发队列回填编辑时完整保留图片与文件附件。
- 执行计划与工具链优化：重做执行计划卡片样式（进度条、状态图标与精简优先级标签），统一工具链状态图标，修复 Codex 空会话反复触发「无法恢复上下文」提示与深色模式确认弹窗样式，移除 90 秒误报卡死提示。

## 0.0.4

- Agent 更新：设置新增「Agent 更新」页，跨 mise / npm / bun / pnpm / Homebrew 检查各 agent CLI 的版本，可单个或一键批量升级，也支持安装缺失的 agent、卸载多余安装，并展示被遮蔽的其他安装渠道。
- 侧栏：会话右键菜单（置顶 / 重命名 / 归档 / 删除），新增归档会话分区。
- 应用图标换成新版本，体积更小。
- 修复若干界面细节（工具链展示、新建会话入口、样式）。

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
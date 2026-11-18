# open-chat

把本机的 coding agent 收进同一个窗口：一个用 Go（mygo）+ Vue + antdv-next 写的桌面工作台，agent 全部通过 [ACP](https://agentclientprotocol.com) 驱动，适配层用 [acp-hub](https://github.com/CarlOpenLab/acp-hub)。

```
┌──────────────────────────────────────────────────────────┐
│  Go 宿主（mygo）                                          │
│   · 会话与记录落盘（index.json + conversations/<id>.json） │
│   · 登录 shell 环境探测（PATH / API key）                  │
│   · mygo.Bind 的 Host API ⇄ 页面；serve 模式下换 HTTP+SSE   │
│   · 管理下面这个 Node 进程                                │
│        │ NDJSON over stdio                               │
│        ▼                                                 │
│  sidecar（Node，打包成单文件，嵌在二进制里）                │
│   · @cc-heart/acp-hub-core 负责 ACP 握手/事件翻译/权限桥接  │
│   · 每个 agent 一个子进程，多个对话共享同一个连接            │
│        │ ACP over stdio                                  │
│        ▼                                                 │
│  Claude Code / Codex / pi / omp / 任意自定义 ACP agent     │
└──────────────────────────────────────────────────────────┘
```

## 为什么分两层

Go 负责桌面该管的事（窗口、目录、对话框、持久化、环境变量），Node 负责 ACP——因为 acp-hub 是 TypeScript 库，而 agent 生态（`npx codex-acp` 之类）本来就在 Node 里。sidecar 编译成单个 `.mjs` 用 `go:embed` 打进二进制，运行时只在缓存目录里落一个文件，用户不需要 `pnpm install`。

宿主和 sidecar 之间只有一种协议：NDJSON。

```jsonc
{"id":1,"method":"open","params":{"key":"…","agent":{…},"cwd":"…"}}
{"id":1,"result":{…}}
{"method":"events","params":{"key":"…","events":[…]}}   // 无 id 即通知
```

## 开发

```bash
pnpm install
pnpm build:sidecar     # 打包 sidecar 到 internal/sidecar/dist
pnpm dev               # mygo dev：窗口 + vite（端口 5173）

# 只想在浏览器里调 UI：
pnpm dev:web           # 另开一个终端：open-chat serve -no-auth
```

没有装任何 agent 也能跑：开发构建默认带一个内置的 **Demo Agent**（思考、计划、工具调用、diff、权限请求、流式 markdown 全套），生产构建用 `OPEN_CHAT_DEMO=1` 打开。

```bash
pnpm build             # mygo build：build/<os>-<arch>/ 下的安装包
go test ./...          # 宿主流程（真的起 node + sidecar + demo agent，跑完一轮）
```

## 网页模式

同一套 UI 也能不开窗口用：

```bash
open-chat serve                     # 127.0.0.1:4310，打印带 token 的地址
open-chat serve -addr 0.0.0.0:4310 -token xxx
open-chat serve -no-auth            # 只在内网/本机
```

HTTP 模式把 `Host` 的每个方法映射成 `POST /api/call/<Method>`（body 是参数数组），推送走 `GET /api/push` 的 SSE。没有 IPC，所以页面代码不用分叉——`web/src/api.ts` 里 `isMyGo()` 一处分流。

## 目录

| 路径 | 内容 |
| --- | --- |
| `main.go` | 入口：`open-chat`（桌面窗口）/ `open-chat serve` |
| `internal/host/` | 会话、落盘、sidecar 进程管理、Host API、HTTP 服务 |
| `sidecar/src/main.ts` | acp-hub 宿主：open / prompt / cancel / permission / setMode / setConfig |
| `sidecar/src/demo-agent.ts` | 内置演示 agent（一个完整的 ACP agent 实现） |
| `web/src/` | Vue 前端（antdv-next + @antdv-next/x） |
| `internal/webdist/` | `go:embed` 的前端产物 |

## 交互要点

- 一个对话 = 一个 ACP session；关掉重开走 `session/load` 续上下文，续不上会给一条提示而不是假装成功。
- 权限请求做成一等公民：卡片浮在消息流里，拒绝比允许难按错（允许在右、拒绝在左）。
- 停止按钮 = `session/cancel`；90 秒没有任何事件会提示「可能卡住了」。
- 斜杠命令来自 agent 的 `available_commands_update`，输入 `/` 直接出列表。
- 图片可以粘贴/选择后作为 `image` 内容块发给 agent（需要 agent 声明 `promptCapabilities.image`）。

## 设置

`~/.config/open-chat/settings.json`：主题、发送键、自动批准、默认 agent、最近目录、node 路径、agent 覆盖（命令/参数/环境变量）、自定义 agent。UI 里的「设置」改的就是它。

数据（会话与记录）在同一目录下的 `index.json` 与 `conversations/`。

## 平台

- macOS：`TitleBarHiddenInset` + 红绿灯内缩，页面左上留白给红绿灯，其余自绘。
- Windows / Linux：隐藏系统按钮，页面右上自绘最小化/最大化/关闭（`HideWindowButtons`）。
- 桌面端启动时向登录 shell 要一次环境变量，所以 Homebrew / mise / nvm 里的 `node`、`claude`、`codex` 都能被找到——从 Dock 启动也不会找不到命令。
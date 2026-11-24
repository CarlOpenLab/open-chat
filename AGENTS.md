# AGENTS.md

open-chat v2：Go（mygo）+ Vue + antdv-next 的桌面 agent 工作台，agent 全部经 ACP（acp-hub）驱动。

## 边界

- **不要在 Go 里实现 ACP。** 协议相关的东西只出现在 `sidecar/`；Go 只跟 sidecar 讲 NDJSON。
- **不要在页面里直接调 agent。** 页面只认 `Host.*`（桌面）或 `POST /api/call/*`（serve），推送只认 `push` 事件。
- 事件模型是 acp-hub 的 `SessionEvent` 加上宿主自己的少量类型（`user_message` / `turn_end` / `notice` / `permission_resolved`）。新增类型要同时改三处：`sidecar` 产出、`internal/host/types.go` 的落盘、`web/src/transcript.ts` 的 reducer。

## 前端约定

- 组件库只用 antdv-next 与 `@antdv-next/x`；样式变量都在 `web/src/styles.css`（`--bg`、`--text`、`--border`…），不要在组件里写死颜色。
- x 组件的类名前缀是 `antd-`（如 `antd-sender`、`antd-bubble`），antdv-next 基础组件是 `ant-`（如 `ant-select`）。覆盖样式时看准前缀。
- 消息渲染走 `transcript.ts`：存档回放和实时推送共用同一个 reducer，任何「只在实时里对」的特效都会在重载后消失，不要这么写。
- 流式文本用 `TextBlock` 单独成组件，靠字符串恒等跳过已完成块的重解析。

## 数据

- `~/.config/open-chat/settings.json`、`index.json`、`conversations/<id>.json`（原子写，400ms 合并）。
- 落盘前会折叠流式噪声：相邻 delta 合并、tool_call_update 折进 tool_call、plan 覆盖、权限结果标记到请求上（见 `store.go` 的 `compact`）。

## 检查

```bash
go test ./...                     # 含一次真实 sidecar 目录检查（node + sidecar）
pnpm typecheck                    # vue-tsc
pnpm build:web && go build ./...  # 产物能编译
```
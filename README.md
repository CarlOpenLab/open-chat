# Open Chat

Open Chat is a Vue 3 coding-agent workspace built with Antdv Next X. The UI can switch between
Codex, OpenCode, Claude Code, Pi, and ordinary OpenAI-compatible model APIs while keeping each
provider's conversations separate.

The server exposes one compatibility gateway modeled after Waku's provider drivers:

- Codex runs through `codex app-server --stdio`.
- Claude Code runs through its native `stream-json` stdin/stdout mode.
- Pi runs through `pi --mode rpc --approve`.
- OpenCode runs through `opencode serve` over local HTTP + SSE.
- Custom ACP agents still run through the official `@agentclientprotocol/sdk`.
- Agent text, thoughts, plans, tool calls, usage, and permission requests are normalized to SSE.
- Existing OpenAI-compatible APIs and the legacy `opencode serve` integration remain available.
- The browser stores conversation history locally in IndexedDB. API keys for manually configured
  model providers are not persisted by the server.

## Setup

Install dependencies with Vite+:

```bash
vp install
```

Create `apps/server/config/providers.toml` from
`apps/server/config/providers.example.toml`, then adjust the enabled integrations. A minimal local
configuration is:

```toml
bind_addr = "127.0.0.1:8082"
cors_allowed_origins = ["http://localhost:3000"]

[local]
enabled = false

[acp]
enabled = true
permission_timeout_ms = 300000
```

The built-in agent definitions detect these local commands directly:

| Provider    | Required command | Native transport         |
| ----------- | ---------------- | ------------------------ |
| Codex       | `codex`          | app-server JSON-RPC      |
| OpenCode    | `opencode`       | local HTTP + SSE         |
| Claude Code | `claude`         | stream-json stdin/stdout |
| Pi          | `pi`             | RPC stdin/stdout         |

No separate `codex-acp`, `claude-code-acp`, or `pi-acp` installation is required. The server checks
the inherited `PATH` and common Homebrew, `~/.local/bin`, Bun, Cargo, mise, and Volta locations.
Override commands or working directories with `[[acp.agents]]`. For a custom ACP implementation,
set `transport = "acp"` and point `command` at the ACP executable.

## Development

```bash
vp run dev
```

- Frontend: http://localhost:3000
- Backend: http://127.0.0.1:8082
- Health: http://127.0.0.1:8082/health

The website dev server proxies `/api` to port 8082.

## Agent API

### `GET /api/acp/agents`

Returns configured agents and their `installed` / `available` status.

### `GET /api/acp/sessions?agentId=codex`

Returns the server's active in-memory session mappings for one agent or all agents.

### `GET /api/acp/session?agentId=codex&conversationId=...`

Creates or reuses the native/ACP session and returns its modes and `configOptions`. Codex models are
discovered from `model/list`, Pi models from RPC, OpenCode models from its local server, and Claude
Code exposes its supported aliases. The model picker uses the select option whose category is
`model`; agents without model discovery remain on their own default model.

### `POST /api/acp/session/config`

Updates one session option through the active native protocol or ACP
`session/set_config_option`. Each conversation keeps its own selected model.

### `POST /api/chat/completions`

The existing chat endpoint also accepts local CLI requests:

```json
{
  "acpAgentId": "codex",
  "conversationId": "browser-conversation-id",
  "messages": [{ "role": "user", "content": "Inspect this repository" }],
  "stream": true
}
```

The response is an SSE stream. Standard assistant text uses OpenAI-compatible chunks; structured
Agent updates use `tool_call`, `acp_plan`, `acp_session`, `acp_turn`, and `chat_permission` events.

### `POST /api/chat/permission`

Resolves legacy OpenCode, native CLI, and ACP permission requests. The UI maps the common actions
`once`, `always`, and `reject` to the decision format used by the active agent.

## Validation

```bash
vp check
vp test
vp run server#build
vp run website#build
```

## Structure

```text
apps/website    Vue 3 and Antdv Next X workspace UI
apps/server     Express gateway, native CLI/ACP managers, API proxy, and OpenCode driver
packages/utils  Shared utilities
```

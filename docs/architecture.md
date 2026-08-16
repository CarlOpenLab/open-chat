# Open Chat Architecture

Open Chat is split into a provider-neutral workspace UI and a local gateway. Provider protocols end at the gateway; the website renders one transcript contract.

## UI Structure

```text
Workspace shell
├── ChatSidebar
│   ├── agent and model selection
│   ├── conversations
│   └── provider sessions
├── Main workspace
│   ├── ChatHeader
│   ├── ChatMessages
│   │   └── one BubbleList item per user or assistant turn
│   │       └── AssistantMessageContent
│   │           ├── ActivityList (reasoning, tools, plan, file work)
│   │           └── final Markdown answer
│   └── ChatInput
└── RightPanel
    └── project and generated-file workspace
```

Reasoning, tool calls, plans, and file changes are activity data inside an assistant turn. They are not standalone chat bubbles. `ActivityList.vue` owns their compact expandable presentation; provider adapters never determine visual styling.

## Data Flow

```text
Codex / Claude / Pi / OMP / OpenCode / ACP
                    │ provider protocol
                    ▼
          SessionRunRegistry (Open Chat 任务)
                    │ snapshot + replay + live SSE
                    ▼
       transcript/adapters/<provider>.ts
                    │ TranscriptMessage / TranscriptStreamEvent
                    ▼
          transcript/core.ts + stream.ts
                    │ JSON history + SSE
                    ▼
      services/transcript.ts + OpenChatProvider
                    │ XModelMessage
                    ▼
                  useXChat
                    │ message state
                    ▼
      ChatMessages -> AssistantMessageContent
```

`XRequest` owns HTTP and SSE transport. `OpenChatProvider` transforms stream frames into model messages. `useXChat` owns request and message state. `Chat.vue` coordinates the workspace but does not parse provider history formats.

## Canonical Transcript

Every history adapter returns this shape:

```ts
interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string;
  toolCalls?: TranscriptActivity[];
  agentPlan?: TranscriptPlan;
}
```

The contract has four invariants:

1. A provider turn produces at most one assistant render item.
2. Adjacent assistant fragments merge until a real user-message boundary.
3. Tool start, progress, result, and error records upsert one activity by `id`.
4. Tool-result protocol records never become user chat messages.

History uses camel-case JSON fields. OpenAI-compatible streaming keeps `content` and `reasoning_content` deltas for SDK compatibility. Structured updates use `tool_call`, `acp_plan`, and `transcript_message`; `transcript/stream.ts` is the only serializer for these shared frames.

## Server Ownership

| Module                     | Responsibility                                                      |
| -------------------------- | ------------------------------------------------------------------- |
| `nativeCliManager.ts`      | Native CLI process, session, permission, and cancellation lifecycle |
| `localProvider.ts`         | OpenCode server and session lifecycle                               |
| `acpManager.ts`            | ACP connection, session, event-bus, and permission lifecycle        |
| `transcript/types.ts`      | Canonical history, activity, plan, and stream types                 |
| `transcript/core.ts`       | Provider-neutral collection, merge, and activity-upsert rules       |
| `transcript/adapters/*.ts` | Provider protocol parsing and normalization                         |
| `transcript/stream.ts`     | Canonical event to SSE serialization                                |

Managers may retain provider lifecycle state such as a process handle, current turn ID, or pending permission. Renderable content must cross the transcript adapter boundary before it leaves the server.

## Open Chat Run Synchronization

`SessionRunRegistry` tracks only turns started by the current Open Chat gateway. At the start of a turn, `AgentManager` stores the provider-neutral history snapshot plus the new user message. It then mirrors every SSE frame written by ACP and native CLI managers into a bounded per-turn buffer.

While an ACP provider is active, the browser periodically refreshes both `GET /api/acp/provider-sessions?agentId=...` (provider-owned session directory and metadata) and `GET /api/acp/sessions?agentId=...` (gateway-owned run state). The loop runs every two seconds while any task is running and every five seconds while idle; hidden pages pause it and resume with an immediate refresh. Each run-state entry exposes `conversationId`, `sessionId`, `running`, and `startedAt`. The gateway-owned query is distinct from provider session discovery and does not claim to detect CLI turns started directly in a terminal.

When a user opens a running session, `GET /api/acp/session/stream` returns the stored snapshot, replays frames already emitted for the active turn, then remains attached to live frames. The UI applies every frame through `OpenChatProvider` and the existing `useXChat` message state. On stream completion it reloads provider history as the final source of truth. Loading or switching a session is read-only from the sidebar's ordering perspective; `updatedAt` changes only when a new user turn is submitted.

Disconnecting the originating browser tab does not cancel a gateway-owned task. Explicit cancellation calls `/api/acp/session/cancel`. The registry is in memory, so a gateway restart ends its tracking and cannot restore an in-flight run.

## Website Ownership

| Module                                        | Responsibility                                   |
| --------------------------------------------- | ------------------------------------------------ |
| `services/acp.ts`                             | Session endpoint transport                       |
| `services/OpenChatProvider.ts`                | SSE protocol transformation only                 |
| `services/transcript.ts`                      | Transcript-to-model and model-to-bubble mapping  |
| `components/Chat.vue`                         | Workspace orchestration                          |
| `components/chat/ChatMessages.vue`            | Message-list behavior                            |
| `components/chat/AssistantMessageContent.vue` | Assistant answer and activity composition        |
| `components/chat/ActivityList.vue`            | Reasoning, tool, plan, and workspace activity UI |

## Adding A Provider

1. Add a focused adapter under `apps/server/src/transcript/adapters`.
2. Convert history to `TranscriptMessage[]` and normalize activity states to `pending`, `running`, `completed`, or `error`.
3. Convert live protocol events to canonical transcript events and serialize them through `transcript/stream.ts`.
4. Keep process and session mechanics in the appropriate manager.
5. Verify one assistant item per turn, tool-result upserts, error termination, and parity between loaded history and live output.

No provider-specific branch should be added to the message rendering components.

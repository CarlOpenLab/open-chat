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
       thin provider adapter in the manager
                    │ ordered native_event SSE
                    ▼
          SessionRunRegistry (replay/broadcast)
                    │ native_event + history snapshot
                    ▼
       OpenChatProvider native event reducer
                    │ XModelMessage
                    ▼
                  useXChat
                    │ message state
                    ▼
      ChatMessages -> AssistantMessageContent
```

`XRequest` owns HTTP and SSE transport. Native CLI content crosses the gateway
as ordered `native_event` frames; the gateway does not accumulate a transcript
while a turn is running. `OpenChatProvider` is the browser-side reducer that
accumulates deltas into the existing `XModelMessage` shape. `useXChat` owns
request and message state. `Chat.vue` coordinates the workspace but does not
parse provider wire formats.

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
  timeline?: TranscriptTimelineItem[];
}
```

The contract has four invariants:

1. A provider turn produces at most one assistant render item.
2. Adjacent assistant fragments merge until a real user-message boundary.
3. Tool start, progress, result, and error records upsert one activity by `id`.
4. Tool-result protocol records never become user chat messages.

History uses camel-case JSON fields. Live agent output uses ordered
`native_event` frames:

```ts
type NativeCliEvent =
  | { type: "content.delta"; content: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "activity.upsert"; activity: TranscriptActivity }
  | { type: "plan.updated"; plan: TranscriptPlan }
  | { type: "turn.completed"; stopReason?: string }
  | { type: "turn.failed"; message: string };
```

Permission, provider-session, retry, and user-control messages remain separate
control events. `transcript/stream.ts` is retained for ordinary upstream
OpenAI compatibility and legacy history snapshots; it is not used for native
turn output.

## Server Ownership

| Module                     | Responsibility                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `nativeCliManager.ts`      | Native CLI process, session, permission, cancellation, and thin event adaptation lifecycle |
| `localProvider.ts`         | OpenCode server and session lifecycle                                                      |
| `acpManager.ts`            | ACP connection, session, event-bus, and permission lifecycle                               |
| `transcript/types.ts`      | Canonical history, activity, plan, and stream types                                        |
| `transcript/core.ts`       | Provider-neutral collection, merge, and activity-upsert rules                              |
| `transcript/adapters/*.ts` | Provider history loading only                                                              |
| `nativeEvents.ts`          | Native event contract and SSE serialization                                                |

Managers may retain provider lifecycle state such as a process handle, current
turn ID, or pending permission. Renderable live content leaves the server as a
native event; history adapters are only used when loading persisted provider
sessions.

## Open Chat Run Synchronization

`SessionRunRegistry` tracks turns started by the current Open Chat gateway. At
the start of a turn, `AgentManager` stores the history snapshot plus the new
user message. It mirrors every native event into a bounded per-turn buffer for
reconnects and additional browser subscribers. Provider sessions started
directly in a terminal are loaded as history snapshots only; the gateway does
not poll and reinterpret provider log files as a fake live stream.

While an ACP provider is active, the browser periodically refreshes both `GET /api/acp/provider-sessions?agentId=...` (provider-owned session directory and metadata) and `GET /api/acp/sessions?agentId=...` (gateway-owned run state). The loop runs every two seconds while any task is running and every five seconds while idle; hidden pages pause it and resume with an immediate refresh. Each run-state entry exposes `conversationId`, `sessionId`, `running`, and `startedAt`. The gateway-owned query is distinct from provider session discovery and does not claim to detect CLI turns started directly in a terminal.

When a user opens a session, `GET /api/acp/session/stream` returns the stored
snapshot, replays frames already emitted for an active turn, then remains
attached to live frames. The UI applies native frames through
`OpenChatProvider` and the existing `useXChat` message state. On stream
completion it reloads provider history as the final source of truth.

Disconnecting the originating browser tab aborts the gateway-owned task and closes its provider turn. Explicit cancellation calls `/api/acp/session/cancel`. The registry is in memory, so a gateway restart ends its tracking and cannot restore an in-flight run.

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
3. Convert only provider-specific wire records into ordered `native_event` frames through `nativeEvents.ts`.
4. Keep process and session mechanics in the appropriate manager.
5. Verify one assistant item per turn, tool-result upserts, error termination, and parity between loaded history and live output.

No provider-specific branch should be added to the message rendering components.

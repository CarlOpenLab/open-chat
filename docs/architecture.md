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

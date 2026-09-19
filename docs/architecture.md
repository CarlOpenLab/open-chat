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

The canonical model is flat and shared by the server and the web client through
the `@cc-heart/open-chat-types` workspace package. Every message carries an
`id` and a Unix-millisecond `timestamp`. An assistant turn is a single flat
`segments` array — there is no parallel `content` / `toolCalls` /
`timeline` shadow structure:

```ts
type TranscriptSegment =
  | { kind: "reasoning"; content: string }
  | { kind: "content"; content: string }
  | {
      kind: "tool";
      id;
      name;
      status;
      providerKind?;
      input?;
      output?;
      error?;
      durationMs?;
      displayTarget?;
    }
  | { kind: "plan"; entries: Array<{ content; status }> }
  | { kind: "fileChange"; path; additions?; deletions?; status? }
  | { kind: "workspace"; files; errors; hasPendingBlock? };

type TranscriptMessage =
  | { id; timestamp; role: "user"; content; attachments?; hidden? }
  | { id; timestamp; role: "assistant"; segments: TranscriptSegment[]; attachments? };
```

The frontend merges adjacent `content` segments into the final answer
(`mergeContentSegments`) and counts activities for the summary
(`summarizeActivities`, "已执行：N 次思考，M 次文件修改"). File
modifications are expressed only by `fileChange` segments — tool segments
never carry file changes (P1).

The contract has four invariants:

1. A provider turn produces at most one assistant render item.
2. Adjacent assistant fragments (and adjacent same-kind segments) merge until a
   real user-message boundary.
3. Tool start, progress, result, and error records upsert one tool segment by `id`.
4. Tool-result protocol records never become user chat messages.

The shared package ships the pure helpers `mergeContentSegments`,
`summarizeActivities`, `applySegmentDelta` (streaming reducer),
`segmentsToOpenAIFormat` (model wire conversion) and `activityToSegments`.
All provider adapters (codex/claude/pi/opencode/acp/sessionEvents) emit the
flat `segments` shape directly — there is no legacy bridge in the pipeline.

User messages may carry `attachments` (images/files). Provider adapters are
responsible for materializing provider-native media into the canonical
reference shape; the Codex adapter, for example, persists `input_image` data
URLs into the gateway attachment store (deduplicated by content hash) and
strips Codex-injected `# Files mentioned by the user` / `## My request:`
boilerplate from the visible text. The web client renders user attachments
through the same `extraInfo.attachments` path as web-uploaded images.

## History Wire Contract

The history API returns a flat, time-ordered (top to bottom) array of records.
Each `HistoryRecord` carries an `id` and Unix-millisecond `timestamp`;
assistant segments are lifted to top-level records — the server does not
pre-group messages:

```ts
type HistoryRecord =
  | { id; timestamp; kind: "user"; content; attachments?; hidden? }
  | { id; timestamp; kind: "reasoning"; content }
  | { id; timestamp; kind: "content"; content }
  | { id; timestamp; kind: "tool"; name; status; providerKind?; input?; output?; error?; ... }
  | { id; timestamp; kind: "plan"; entries }
  | { id; timestamp; kind: "fileChange"; path; additions?; deletions?; status? }
  | { id; timestamp; kind: "workspace"; files; errors; hasPendingBlock? };
```

Both sides share one segmentation implementation in the shared package:
`flattenHistory(messages)` flattens the internal message model into records
(the server applies it at the API boundary), and `segmentHistory(records)`
regroups records into user/assistant messages — user records start a new user
message and close the current assistant turn, adjacent `content` /
`reasoning` records merge, tool upserts by id, fileChange upserts by path,
and `<files>` workspace blocks inside content records are split into
`workspace` segments. The frontend calls `segmentHistory` on the records it
receives before rendering; the gateway calls it again when it needs a message
sequence.

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

## Session Event Adapter

Sessions can also be rendered as an event log: one JSON event per line, with
numbered `seq` events (`turn/start`, `user/message`, `assistant/message`,
`tool/call`, `tool/result`, `step/start`, `step/end`, `turn/end`,
`session/title`) that must keep strict discipline before a resumed conversation
is accepted by model APIs. Open Chat exposes a bidirectional event-log adapter
around the canonical `TranscriptMessage` contract:

- `transcript/sessionEvents.ts` — `synthesizeSessionEvents(history, options)`
  renders the canonical history into session events (droppable straight into a
  per-line JSON log). Event discipline is enforced: continuous `seq`,
  `surfaceOp: 'append'` on surface events, `sourceEventSeqs` linking each
  `tool/result` to its `tool/call`, and the pairing invariant (every
  `tool/call` gets a `tool/result`, so model APIs accept the resumed thread).
  Content the log cannot express (`agentPlan`, `attachments`) is skipped and
  reported through `degradations` — fail loudly, never silently.
  `validateSessionEvents` runs a structural self-check on any synthesized log.
- `transcript/adapters/sessionEvents.ts` — `convertSessionEventsHistory(lines)`
  reads event lines back into the canonical history (text → `content`,
  reasoning → `reasoningContent`, `tool-call` blocks / `tool/call` events →
  `toolCalls`, `tool/result` upserted by `toolCallId` onto the owning assistant
  message), mirroring the other history adapters.

This makes a conversation portable in both directions: an Open Chat session can
be exported as a resumable session log, and a session log can be opened and
rendered in the workspace.

## Server Ownership

| Module                     | Responsibility                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `acpManager.ts`            | All stdio CLI agents (codex/claude/pi/omp/custom ACP): session, permission, cancellation, and event-bus lifecycle on top of acp-hub adapters |
| `openCodeManager.ts`       | OpenCode agent view + session delegation to the local HTTP provider (`localProvider.ts`)                                                     |
| `historyReaders.ts`        | Loading persisted provider sessions from native CLI stores (Claude/Pi JSONL, Codex turns)                                                    |
| `localProvider.ts`         | OpenCode server and session lifecycle                                                                                                        |
| `transcript/types.ts`      | Canonical history, activity, plan, and stream types                                                                                          |
| `transcript/core.ts`       | Provider-neutral collection, merge, and activity-upsert rules                                                                                |
| `transcript/adapters/*.ts` | Provider history loading only (`hub.ts` also accumulates live acp-hub unified events)                                                        |
| `nativeEvents.ts`          | Native event contract and SSE serialization                                                                                                  |

Live turns for every stdio agent speak ACP: `acpManager` delegates process
spawn, handshake, and protocol translation to the vendored
[`acp-hub`](https://github.com/CarlOpenLab/acp-hub) adapters
(`vendor/acp-hub/packages/adapter-*`, wired in as pnpm workspace members).
The manager consumes acp-hub's unified `SessionEvent` stream
(`message_delta` / `thought_delta` / `tool_call(_update)` / `plan` / `usage` /
`permission_request`), merges partial `tool_call_update`s against per-turn
snapshots, and reuses the same native-event SSE contract below. Bridge-specific
capabilities (models, modes, config options) surface through the ACP session
response and `session/set_config_option`; agents whose bridge advertises no
config options simply show no selector.

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

The browser does not poll a session-list endpoint. Run state is derived from
three local signals: turns started by the open tab (`activeSessionRuns`), the
`running` flag that `GET /api/acp/session` reports from the server's
`activeRuns` for the currently selected conversation, and the SSE stream that
attaches to a detected running turn. Hidden pages detach the stream; on
becoming visible the UI refreshes the current conversation state and
re-attaches if a run is in progress.

Codex history loading uses `thread/read` with full turns. That call blocks while
the same thread has an active writer (the Codex terminal, the desktop app, or
another app-server has the session open), so the server falls back to paged
`thread/turns/list` summary pages — which stay readable — before treating the
history as empty.

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

Stdio CLI agents:

1. Add (or reuse) an acp-hub adapter package for the agent's ACP bridge — either
   a new `packages/adapter-*` in `vendor/acp-hub`, or the generic
   `createAcpAgentAdapter(command, args)` for any ACP-speaking executable.
2. Register the transport in `apps/server/src/config.ts` (`DEFAULT_ACP_AGENTS`)
   and map it in `AcpManager.createAdapter`.
3. If the agent persists sessions in its own store, extend
   `apps/server/src/historyReaders.ts` so deep links can load provider history.
4. Verify one assistant item per turn, tool-result upserts, error termination,
   permission round-trip, and parity between loaded history and live output.

Other provider types (HTTP APIs, local servers) keep the existing pattern: a
focused history adapter under `apps/server/src/transcript/adapters`, conversion
to `TranscriptMessage[]` with activity states normalized to `pending`,
`running`, `completed`, or `error`, and provider-specific wire records
converted into ordered `native_event` frames through `nativeEvents.ts`.

No provider-specific branch should be added to the message rendering components.

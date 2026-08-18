// transcript/sessionEvents.ts — 会话事件日志合成器
//
// 把 open-chat 的规范历史（TranscriptMessage[]）合成为会话事件日志
// （每行一个 JSON 事件，可逐行落盘），供外部会话格式导入 / 会话可移植复用。
//
// 事件纪律（会话恢复时模型 API 才放行）：
//   - seq 从 0 连续编号；
//   - surface 事件（user/message、assistant/message、tool/result）带
//     surfaceOp:'append'，读侧才放行；
//   - tool/result 用 sourceEventSeqs 关联其 tool/call（异步工具可跨 step 到达）；
//   - 配对不变量：每个 tool/call 必须有对应 tool/result，否则会话恢复时模型 API
//     拒绝（assistant 带 tool_calls 但缺 tool 消息）——无结果的 activity 补发空结果；
//   - 无法表达的内容（agentPlan、attachments）跳过并计数（降级显式报告，失败要大声）。
//
// 本模块为纯函数，零宿主依赖（可独立单测）；反向读取见 adapters/sessionEvents.ts。

import type { TranscriptActivity, TranscriptMessage } from "./types";

/** 会话事件类型白名单。 */
export type SessionEventType =
  | "session/imported"
  | "session/title"
  | "turn/start"
  | "turn/end"
  | "step/start"
  | "step/end"
  | "user/message"
  | "assistant/message"
  | "tool/call"
  | "tool/result";

export const SESSION_EVENT_TYPES: readonly SessionEventType[] = [
  "session/imported",
  "session/title",
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
  "user/message",
  "assistant/message",
  "tool/call",
  "tool/result",
];

const SURFACE_EVENT_TYPES = new Set<SessionEventType>([
  "user/message",
  "assistant/message",
  "tool/result",
]);

/** 单个会话事件（日志的一行）。 */
export interface SessionEvent {
  type: SessionEventType;
  seq: number;
  time: number;
  surfaceOp?: "append";
  sourceEventSeqs?: number[];
  ignorable?: boolean;
  data: Record<string, unknown>;
}

export interface SessionMeta {
  id: string;
  createdAt: number;
  cwd?: string;
}

export interface SessionOptions {
  meta: SessionMeta;
  /** 源标识（同 session/imported 标记的 tool，如 "codex" / "claude" / "open-chat"）。 */
  provider: string;
  model?: string;
  title?: string;
  /** 可选来源标记：写 session/imported 事件（ignorable，读侧全链路放行）。 */
  imported?: { tool: string; sourceId?: string; sourcePath?: string };
}

export interface SessionResult {
  events: SessionEvent[];
  meta: SessionMeta;
  provider: string;
  model?: string;
  title?: string;
  messages: number;
  toolCalls: number;
  /** 降级清单（count > 0 才列出）；无降级返回 undefined，不占结果键。 */
  degradations: Degradation[] | undefined;
  validation: { ok: boolean; problems: ValidationProblem[] };
}

export type DegradationStrategy = "lossless" | "text-fallback" | "skip-placeholder";

export interface Degradation {
  id: string;
  kind: string;
  strategy: DegradationStrategy;
  count: number;
}

/** 降级规则表（能力缺口 → 策略三态）。本合成方向只列出实际会触发的项。 */
const DEGRADATION_RULES: ReadonlyArray<{
  id: string;
  kind: string;
  strategy: DegradationStrategy;
}> = [
  {
    id: "plan-skipped",
    kind: "planSkipped",
    strategy: "skip-placeholder",
  },
  {
    id: "attachment-skipped",
    kind: "attachmentSkipped",
    strategy: "skip-placeholder",
  },
  {
    id: "pending-tool-result",
    kind: "pendingToolResult",
    strategy: "skip-placeholder",
  },
  {
    id: "workspace-skipped",
    kind: "workspaceSkipped",
    strategy: "skip-placeholder",
  },
];

// ── 合成 ──────────────────────────────────────────────────────────────────

interface TurnGroup {
  prompt: string;
  userAttachments: number;
  steps: TranscriptMessage[];
}

/** 按 turn 分组：user message 开启新 turn；assistant 消息并入当前 turn（作为 step）。 */
function groupTurns(history: TranscriptMessage[]): TurnGroup[] {
  const turns: TurnGroup[] = [];
  for (const message of history) {
    if (message.role === "user") {
      turns.push({
        prompt: message.content,
        userAttachments: message.attachments?.length ?? 0,
        steps: [],
      });
    } else {
      if (turns.length === 0) turns.push({ prompt: "", userAttachments: 0, steps: [] });
      turns[turns.length - 1].steps.push(message);
    }
  }
  return turns;
}

function toolArguments(input: unknown): string {
  if (input === undefined || input === null) return "{}";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return "{}";
  }
}

/** 单条扁平消息 → 内容块（text / reasoning / tool-call）。 */
function assistantBlocks(message: TranscriptMessage): unknown[] {
  const blocks: unknown[] = [];
  if (message.role === "reasoning") {
    if (message.content.trim()) blocks.push({ type: "reasoning", text: message.content });
  } else if (message.role === "content") {
    if (message.content.trim()) blocks.push({ type: "text", text: message.content });
  }
  for (const call of stepActivities(message)) {
    blocks.push({
      type: "tool-call",
      id: call.id,
      name: call.name,
      arguments: toolArguments(call.input),
    });
  }
  return blocks;
}

/** 单条扁平消息的可执行活动：tool 消息 / fileChange 消息（会话事件需要 tool/call→tool/result 配对）。 */
function stepActivities(message: TranscriptMessage): TranscriptActivity[] {
  if (message.role === "tool") {
    return [
      {
        id: message.id,
        name: message.name,
        status: message.status,
        ...(message.providerKind !== undefined ? { kind: message.providerKind } : {}),
        ...(message.input !== undefined ? { input: message.input } : {}),
        ...(message.output !== undefined ? { output: message.output } : {}),
        ...(message.error !== undefined ? { error: message.error } : {}),
        ...(message.durationMs !== undefined ? { durationMs: message.durationMs } : {}),
        ...(message.displayTarget !== undefined ? { displayTarget: message.displayTarget } : {}),
      },
    ];
  }
  if (message.role === "fileChange") {
    return [
      {
        id: `file-${message.path}`,
        name: "file_change",
        kind: "fileChange",
        status: message.status ?? "completed",
        fileChanges: [
          {
            path: message.path,
            ...(message.additions !== undefined ? { additions: message.additions } : {}),
            ...(message.deletions !== undefined ? { deletions: message.deletions } : {}),
          },
        ],
      },
    ];
  }
  return [];
}

/** activity → tool/result 事件里的 message（配对不变量：无结果补空 content）。 */
function toolResultMessage(
  sessionId: string,
  turn: number,
  step: number,
  call: TranscriptActivity,
  degraded: boolean,
): Record<string, unknown> {
  const errored = call.status === "error";
  const content: unknown[] = [];
  if (errored) {
    content.push({ type: "text", text: call.error ?? call.output ?? "" });
  } else if (
    call.status === "completed" &&
    typeof call.output === "string" &&
    call.output.length > 0
  ) {
    content.push({ type: "text", text: call.output });
  }
  const block: Record<string, unknown> = { type: "tool-result", toolCallId: call.id, content };
  if (errored) block.isError = true;
  if (degraded) block.degraded = true;
  return {
    id: `openchat:${sessionId}:t${turn}:${step}:${call.id}`,
    role: "user",
    content: [block],
    source: { kind: "tool", callId: call.id },
  };
}

/** 把规范历史合成为会话事件日志。纯函数；events 可逐行 JSON.stringify 落盘。 */
export function synthesizeSessionEvents(
  history: TranscriptMessage[],
  options: SessionOptions,
): SessionResult {
  const { meta, provider, model } = options;
  const events: SessionEvent[] = [];
  const counts = new Map<string, number>();
  let seq = 0;
  let turn = 0;

  const bump = (kind: string) => counts.set(kind, (counts.get(kind) ?? 0) + 1);

  const push = (
    type: SessionEventType,
    data: Record<string, unknown>,
    surface = false,
    sourceEventSeqs?: number[],
  ): SessionEvent => {
    const ev: SessionEvent = { type, seq: seq++, time: meta.createdAt, data };
    if (surface) ev.surfaceOp = "append";
    if (sourceEventSeqs !== undefined) ev.sourceEventSeqs = sourceEventSeqs;
    events.push(ev);
    return ev;
  };

  const turns = groupTurns(history);

  // 会话级 callId → seq 索引：异步工具结果可能晚于其 tool/call 到达。
  const callSeqByCallId = new Map<string, number>();

  // 有真实结果（completed/error）的 callId 集合：补空结果只针对无结果的调用，
  // 避免给已完成的调用重复补出空结果。
  const coveredCallIds = new Set<string>();
  for (const t of turns) {
    for (const step of t.steps) {
      for (const call of stepActivities(step)) {
        if (call.status === "completed" || call.status === "error") coveredCallIds.add(call.id);
      }
    }
  }

  if (history.length > 0) {
    events.push({
      type: "session/imported",
      seq: seq++,
      time: meta.createdAt,
      ignorable: true,
      data: {
        tool: options.imported?.tool ?? provider,
        ...(options.imported?.sourceId ? { sourceId: options.imported.sourceId } : {}),
        ...(options.imported?.sourcePath ? { sourcePath: options.imported.sourcePath } : {}),
        importedAt: Date.now(),
      },
    });
  }

  for (const t of turns) {
    turn += 1;
    push("turn/start", { turn });
    if (t.prompt.trim()) {
      push(
        "user/message",
        {
          id: `openchat:${meta.id}:u${turn}`,
          role: "user",
          content: [{ type: "text", text: t.prompt }],
          source: { kind: "user" },
        },
        true,
      );
    }
    let stepNum = 0;
    for (const message of t.steps) {
      // plan / workspace 无法用会话事件表达：跳过并显式报告降级。
      if (message.role === "plan") {
        bump("planSkipped");
        continue;
      }
      if (message.role === "workspace") {
        bump("workspaceSkipped");
        continue;
      }
      const activities = stepActivities(message);
      if (assistantBlocks(message).length === 0 && activities.length === 0) continue;
      stepNum += 1;
      push("step/start", { turn, step: stepNum });
      push(
        "assistant/message",
        {
          turn,
          step: stepNum,
          message: {
            id: `openchat:${meta.id}:a${turn}:${stepNum}`,
            role: "assistant",
            content: assistantBlocks(message),
            source: { kind: "model", provider, model: model ?? provider },
          },
        },
        true,
      );
      for (const call of activities) {
        const ev = push("tool/call", {
          turn,
          step: stepNum,
          callId: call.id,
          name: call.name,
          arguments: toolArguments(call.input),
        });
        callSeqByCallId.set(call.id, ev.seq);
      }
      for (const call of activities) {
        const callSeq = callSeqByCallId.get(call.id);
        const degraded = !coveredCallIds.has(call.id);
        if (degraded) bump("pendingToolResult");
        push(
          "tool/result",
          {
            turn,
            step: stepNum,
            message: toolResultMessage(meta.id, turn, stepNum, call, degraded),
          },
          true,
          callSeq !== undefined ? [callSeq] : undefined,
        );
      }
      push("step/end", { turn, step: stepNum });
    }
    push("turn/end", { turn, reason: { kind: "completed" } });
  }

  for (const t of turns) {
    if (t.userAttachments > 0) bump("attachmentSkipped");
    for (const step of t.steps) {
      if (
        (step.role === "user" || step.role === "content") &&
        (step.attachments?.length ?? 0) > 0
      ) {
        bump("attachmentSkipped");
      }
    }
  }

  const title = (options.title ?? "").trim();
  if (title.length > 0) {
    push("session/title", { title, messageSeqs: [], source: { kind: "user" } });
  }

  const degradations: Degradation[] = [];
  for (const rule of DEGRADATION_RULES) {
    const count = counts.get(rule.kind);
    if (typeof count === "number" && count > 0) {
      degradations.push({ id: rule.id, kind: rule.kind, strategy: rule.strategy, count });
    }
  }

  const messages = events.filter(
    (e) => e.type === "user/message" || e.type === "assistant/message" || e.type === "tool/result",
  ).length;
  const toolCalls = events.filter((e) => e.type === "tool/call").length;

  return {
    events,
    meta,
    provider,
    ...(model ? { model } : {}),
    ...(title ? { title } : {}),
    messages,
    toolCalls,
    degradations: degradations.length > 0 ? degradations : undefined,
    validation: validateSessionEvents(events),
  };
}

// ── 校验 ──────────────────────────────────────────────────────────────────

export interface ValidationProblem {
  kind: string;
  seq: number | null;
  message: string;
}

export const VALIDATION_PROBLEM_CAP = 20;

/** 轻量自检：seq 连续无重复、事件类型白名单、surface 事件带 surfaceOp、tool/result
 * 的 sourceEventSeqs 指向集合内存在的 tool/call（指向集合外的引用合法——append 尾片
 * 跨轮引用前段事件，此处无法验证——不报）。problems 封顶 VALIDATION_PROBLEM_CAP 条。 */
export function validateSessionEvents(events: SessionEvent[]): {
  ok: boolean;
  problems: ValidationProblem[];
} {
  const problems: ValidationProblem[] = [];
  const report = (kind: string, seq: number | null, message: string) => {
    if (problems.length < VALIDATION_PROBLEM_CAP) problems.push({ kind, seq, message });
  };
  if (!Array.isArray(events)) {
    return { ok: false, problems: [{ kind: "not-array", seq: null, message: "events 不是数组" }] };
  }
  const bySeq = new Map<number, SessionEvent>();
  for (const ev of events) {
    if (!ev || typeof ev !== "object") {
      report("malformed", null, "事件条目不是对象");
      continue;
    }
    const seq = typeof ev.seq === "number" && Number.isInteger(ev.seq) ? ev.seq : null;
    if (seq === null) {
      report("missing-seq", null, `事件缺整数 seq：${String(ev.type)}`);
      continue;
    }
    if (bySeq.has(seq)) report("duplicate-seq", seq, `seq 重复：${seq}`);
    bySeq.set(seq, ev);
  }
  const sorted = [...bySeq.keys()].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      report("seq-gap", sorted[i], `seq 不连续：${sorted[i - 1]} → ${sorted[i]}`);
    }
  }
  for (const ev of bySeq.values()) {
    if (!SESSION_EVENT_TYPES.includes(ev.type)) {
      report("unknown-type", ev.seq, `未知事件类型：${String(ev.type)}`);
    }
    if (SURFACE_EVENT_TYPES.has(ev.type) && ev.surfaceOp !== "append") {
      report("missing-surface-op", ev.seq, `surface 事件缺 surfaceOp:'append'：${ev.type}`);
    }
    if (Array.isArray(ev.sourceEventSeqs)) {
      for (const ref of ev.sourceEventSeqs) {
        const target = bySeq.get(ref);
        if (target && target.type !== "tool/call") {
          report("source-event-seqs-not-call", ev.seq, `sourceEventSeqs 指向非 tool/call：${ref}`);
        }
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

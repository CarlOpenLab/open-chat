// Folds a conversation's event stream into turns for display. The same
// reducer runs over the stored transcript and over live pushes, so a
// conversation looks the same while streaming and after a reload.
import type { Block, HostEvent, PermissionOption, PlanEntry, ToolCall } from "./types";

export type Segment =
  | { kind: "thought"; id: string; text: string; startedAt: number; endedAt?: number }
  | { kind: "text"; id: string; text: string }
  | { kind: "tools"; id: string; calls: ToolCall[] }
  | { kind: "plan"; id: string; entries: PlanEntry[] }
  | {
      kind: "permission";
      id: string;
      requestId: string;
      toolCall?: ToolCall;
      options: PermissionOption[];
      resolved?: { optionId: string | null; auto?: boolean };
    }
  | { kind: "notice"; id: string; level: "info" | "warn" | "error"; text: string };

export interface Turn {
  id: string;
  user: { blocks: Block[]; t: number } | null;
  segments: Segment[];
  startedAt: number;
  end: { stopReason: string; error?: string; durationMs?: number; t: number } | null;
}

export interface Transcript {
  turns: Turn[];
  /** Bumped on every change, for cheap watchers (auto-scroll). */
  version: number;
}

let seq = 0;
const sid = () => `s${++seq}`;

export function emptyTranscript(): Transcript {
  return { turns: [], version: 0 };
}

function currentTurn(tr: Transcript, t: number): Turn {
  let turn = tr.turns[tr.turns.length - 1];
  if (!turn) {
    turn = { id: sid(), user: null, segments: [], startedAt: t, end: null };
    tr.turns.push(turn);
    return turn;
  }
  if (turn.end) {
    // Output that arrives just after its turn ended (a late frame, or a
    // duplicate push) belongs to that turn, not to a new empty one.
    if (t - turn.end.t < 2000) return turn;
    turn = { id: sid(), user: null, segments: [], startedAt: t, end: null };
    tr.turns.push(turn);
  }
  return turn;
}

function closeThought(turn: Turn, t: number) {
  const last = turn.segments[turn.segments.length - 1];
  if (last?.kind === "thought" && !last.endedAt) last.endedAt = t;
}

function findCall(turn: Turn, id: string): { seg: Extract<Segment, { kind: "tools" }>; index: number } | null {
  for (let i = turn.segments.length - 1; i >= 0; i--) {
    const seg = turn.segments[i];
    if (seg.kind !== "tools") continue;
    const index = seg.calls.findIndex((c) => c.toolCallId === id);
    if (index >= 0) return { seg, index };
  }
  return null;
}

export function apply(tr: Transcript, events: HostEvent[]): void {
  for (const e of events) applyOne(tr, e);
  tr.version++;
}

function applyOne(tr: Transcript, e: HostEvent): void {
  const t = e.t ?? Date.now();
  switch (e.type) {
    case "user_message": {
      if (e.id && tr.turns.some((turn) => turn.id === e.id)) return;
      const prev = tr.turns[tr.turns.length - 1];
      if (prev && !prev.end) {
        closeThought(prev, t);
        prev.end = { stopReason: "end_turn", t };
      }
      tr.turns.push({ id: e.id || sid(), user: { blocks: e.blocks, t }, segments: [], startedAt: t, end: null });
      return;
    }
    case "thought_delta": {
      const turn = currentTurn(tr, t);
      const last = turn.segments[turn.segments.length - 1];
      if (last?.kind === "thought" && !last.endedAt) last.text += e.text;
      else turn.segments.push({ kind: "thought", id: sid(), text: e.text, startedAt: t });
      return;
    }
    case "message_delta": {
      const turn = currentTurn(tr, t);
      closeThought(turn, t);
      const last = turn.segments[turn.segments.length - 1];
      if (last?.kind === "text") last.text += e.text;
      else turn.segments.push({ kind: "text", id: sid(), text: e.text });
      return;
    }
    case "tool_call":
    case "tool_call_update": {
      const turn = currentTurn(tr, t);
      closeThought(turn, t);
      const found = findCall(turn, e.toolCall.toolCallId);
      if (found) {
        found.seg.calls[found.index] = { ...found.seg.calls[found.index], ...e.toolCall };
        return;
      }
      const last = turn.segments[turn.segments.length - 1];
      if (last?.kind === "tools") last.calls.push({ ...e.toolCall });
      else turn.segments.push({ kind: "tools", id: sid(), calls: [{ ...e.toolCall }] });
      return;
    }
    case "plan": {
      const turn = currentTurn(tr, t);
      const existing = turn.segments.find((s) => s.kind === "plan");
      if (existing && existing.kind === "plan") existing.entries = e.entries;
      else {
        closeThought(turn, t);
        turn.segments.push({ kind: "plan", id: sid(), entries: e.entries });
      }
      return;
    }
    case "permission_request": {
      const turn = currentTurn(tr, t);
      closeThought(turn, t);
      turn.segments.push({
        kind: "permission",
        id: sid(),
        requestId: e.requestId,
        toolCall: e.toolCall,
        options: e.options,
        resolved: e.resolved,
      });
      return;
    }
    case "permission_resolved": {
      for (let i = tr.turns.length - 1; i >= 0; i--) {
        const seg = tr.turns[i].segments.find((s) => s.kind === "permission" && s.requestId === e.requestId);
        if (seg && seg.kind === "permission") {
          seg.resolved = { optionId: e.optionId, auto: e.auto };
          return;
        }
      }
      return;
    }
    case "agent_error": {
      const turn = currentTurn(tr, t);
      turn.segments.push({ kind: "notice", id: sid(), level: "error", text: e.message });
      return;
    }
    case "notice": {
      const turn = tr.turns[tr.turns.length - 1];
      if (turn && !turn.end) {
        const lastSeg = turn.segments[turn.segments.length - 1];
        if (lastSeg?.kind === "notice" && lastSeg.text === e.text) return;
        turn.segments.push({ kind: "notice", id: sid(), level: e.level, text: e.text });
      } else {
        const lastSeg = turn?.segments[turn.segments.length - 1];
        if (lastSeg?.kind === "notice" && lastSeg.text === e.text) return;
        tr.turns.push({ id: sid(), user: null, segments: [{ kind: "notice", id: sid(), level: e.level, text: e.text }], startedAt: t, end: { stopReason: "notice", t } });
      }
      return;
    }
    case "turn_end": {
      const last = tr.turns[tr.turns.length - 1];
      if (last?.end) return; // a repeated end for a turn already closed
      const turn = currentTurn(tr, t);
      closeThought(turn, t);
      // An unanswered permission request can't be answered any more.
      for (const seg of turn.segments) {
        if (seg.kind === "permission" && !seg.resolved) seg.resolved = { optionId: null };
        if (seg.kind === "tools")
          for (const c of seg.calls)
            if (c.status === "pending" || c.status === "in_progress") c.status = e.stopReason === "end_turn" ? "completed" : "failed";
      }
      turn.end = { stopReason: e.stopReason, error: e.error, durationMs: e.durationMs, t };
      return;
    }
    default:
      return;
  }
}

/** The plain text of a turn's answer, for copying. */
export function answerText(turn: Turn): string {
  return turn.segments
    .filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("\n\n")
    .trim();
}

export function userText(blocks: Block[]): string {
  return blocks
    .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

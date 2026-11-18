/**
 * A scripted ACP agent, for trying the UI without any real agent installed
 * and for end-to-end tests. It exercises every event the UI renders:
 * thinking, a plan, read/execute/edit tool calls, a permission request,
 * streamed markdown, usage, modes, config options and slash commands.
 *
 * Runs as `node sidecar.mjs --demo-agent`, speaking ACP over stdio.
 */
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface DemoSession {
  mode: string;
  model: string;
  effort: string;
  turns: number;
  abort: AbortController | null;
  cwd: string;
}

const MODES = [
  { id: "default", name: "默认", description: "修改文件前先征求同意" },
  { id: "accept-edits", name: "自动编辑", description: "直接修改文件，命令仍需确认" },
  { id: "plan", name: "规划", description: "只读：先出计划，不动文件" },
];

function configOptions(s: DemoSession): acp.SessionConfigOption[] {
  return [
    {
      id: "model",
      name: "模型",
      category: "model",
      type: "select",
      currentValue: s.model,
      options: [
        { value: "demo-swift", name: "Swift", description: "快，适合小改动" },
        { value: "demo-sonnet", name: "Sonnet", description: "均衡" },
        { value: "demo-opus", name: "Opus", description: "最强推理" },
      ],
    },
    {
      id: "effort",
      name: "思考强度",
      category: "thought_level",
      type: "select",
      currentValue: s.effort,
      options: [
        { value: "low", name: "低" },
        { value: "medium", name: "中" },
        { value: "high", name: "高" },
      ],
    },
  ];
}

function chunks(text: string, size = 6): string[] {
  const out: string[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out;
}

class DemoAgent implements acp.Agent {
  private sessions = new Map<string, DemoSession>();
  constructor(private conn: acp.AgentSideConnection) {}

  async initialize(): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: "demo", title: "Demo Agent", version: "1.0.0" },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: true },
      },
      authMethods: [],
    };
  }

  async authenticate(): Promise<acp.AuthenticateResponse> {
    return {};
  }

  private create(sessionId: string, cwd: string): acp.NewSessionResponse {
    const session: DemoSession = { mode: "default", model: "demo-sonnet", effort: "medium", turns: 0, abort: null, cwd };
    this.sessions.set(sessionId, session);
    setTimeout(() => {
      void this.conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "review", description: "审查当前改动" },
            { name: "explain", description: "解释一段代码" },
            { name: "test", description: "补测试并运行" },
            { name: "compact", description: "压缩上下文" },
          ],
        },
      });
    }, 50);
    return {
      sessionId,
      modes: { currentModeId: session.mode, availableModes: MODES },
      configOptions: configOptions(session),
    };
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    return this.create(`demo-${Math.random().toString(36).slice(2, 10)}`, params.cwd);
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    const { sessionId: _, ...rest } = this.create(params.sessionId, params.cwd);
    return rest;
  }

  async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
    const s = this.sessions.get(params.sessionId);
    if (s) s.mode = params.modeId;
    return {};
  }

  async setSessionConfigOption(params: acp.SetSessionConfigOptionRequest): Promise<acp.SetSessionConfigOptionResponse> {
    const s = this.sessions.get(params.sessionId);
    if (!s) throw acp.RequestError.invalidParams({}, "unknown session");
    if (params.configId === "model") s.model = String(params.value);
    if (params.configId === "effort") s.effort = String(params.value);
    return { configOptions: configOptions(s) };
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.abort?.abort();
  }

  private async update(sessionId: string, update: acp.SessionNotification["update"]) {
    await this.conn.sessionUpdate({ sessionId, update });
  }

  private async stream(sessionId: string, kind: "agent_message_chunk" | "agent_thought_chunk", text: string, signal: AbortSignal, pace = 18) {
    for (const piece of chunks(text)) {
      if (signal.aborted) throw new Error("aborted");
      await this.update(sessionId, { sessionUpdate: kind, content: { type: "text", text: piece } });
      await sleep(pace);
    }
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const s = this.sessions.get(params.sessionId);
    if (!s) throw acp.RequestError.invalidParams({}, "unknown session");
    s.abort?.abort();
    const abort = new AbortController();
    s.abort = abort;
    const signal = abort.signal;
    s.turns += 1;
    const id = params.sessionId;
    const text = params.prompt
      .map((block) => (block.type === "text" ? block.text : block.type === "image" ? "[图片]" : block.type === "resource_link" ? `@${block.name}` : ""))
      .join(" ")
      .trim();
    const images = params.prompt.filter((block) => block.type === "image").length;

    try {
      if (s.turns === 1) {
        await this.update(id, { sessionUpdate: "session_info_update", title: text.slice(0, 24) || "新对话" } as never);
      }

      await this.stream(
        id,
        "agent_thought_chunk",
        `用户想要：「${text.slice(0, 60)}」。${images ? `附带了 ${images} 张图片，先看图。` : ""}先看看 ${s.cwd} 的项目结构，确认入口文件和测试命令，再决定怎么改。改动要小，改完跑一遍测试。`,
        signal,
        14,
      );

      const plan: acp.PlanEntry[] = [
        { content: "阅读项目结构与入口", priority: "high", status: "in_progress" },
        { content: "修改 src/greet.ts", priority: "high", status: "pending" },
        { content: "运行测试确认", priority: "medium", status: "pending" },
      ];
      await this.update(id, { sessionUpdate: "plan", entries: plan });

      // read
      await this.update(id, {
        sessionUpdate: "tool_call",
        toolCallId: "read-1",
        title: "读取 package.json",
        kind: "read",
        status: "in_progress",
        locations: [{ path: `${s.cwd}/package.json` }],
        rawInput: { path: "package.json" },
      });
      await sleep(450);
      await this.update(id, {
        sessionUpdate: "tool_call_update",
        toolCallId: "read-1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: '{\n  "name": "demo",\n  "scripts": { "test": "vitest run" }\n}' } }],
      });

      // search
      await this.update(id, {
        sessionUpdate: "tool_call",
        toolCallId: "grep-1",
        title: "搜索 greet(",
        kind: "search",
        status: "in_progress",
        rawInput: { pattern: "greet(" },
      });
      await sleep(380);
      await this.update(id, {
        sessionUpdate: "tool_call_update",
        toolCallId: "grep-1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "src/greet.ts:3\nsrc/main.ts:8\ntest/greet.test.ts:5" } }],
      });
      plan[0]!.status = "completed";
      plan[1]!.status = "in_progress";
      await this.update(id, { sessionUpdate: "plan", entries: plan });

      if (s.mode !== "plan") {
        // edit, guarded by a permission request unless edits are auto-accepted
        const edit: acp.ToolCallUpdate = {
          toolCallId: "edit-1",
          title: "编辑 src/greet.ts",
          kind: "edit",
          status: "pending",
          locations: [{ path: `${s.cwd}/src/greet.ts`, line: 3 }],
          content: [
            {
              type: "diff",
              path: `${s.cwd}/src/greet.ts`,
              oldText: 'export function greet(name: string) {\n  return "Hello " + name;\n}\n',
              newText:
                'export function greet(name: string, punctuation = "!") {\n  const who = name.trim() || "stranger";\n  return `Hello, ${who}${punctuation}`;\n}\n',
            },
          ],
          rawInput: { file_path: "src/greet.ts" },
        };
        await this.update(id, { sessionUpdate: "tool_call", ...edit, title: edit.title!, status: "pending" });
        let allowed = s.mode === "accept-edits";
        if (!allowed) {
          const answer = await this.conn.requestPermission({
            sessionId: id,
            toolCall: edit,
            options: [
              { optionId: "allow", name: "允许", kind: "allow_once" },
              { optionId: "always", name: "本会话都允许", kind: "allow_always" },
              { optionId: "reject", name: "拒绝", kind: "reject_once" },
            ],
          });
          if (signal.aborted) return { stopReason: "cancelled" };
          allowed = answer.outcome.outcome === "selected" && answer.outcome.optionId !== "reject";
          if (answer.outcome.outcome === "selected" && answer.outcome.optionId === "always") s.mode = "accept-edits";
        }
        await this.update(id, { sessionUpdate: "tool_call_update", toolCallId: "edit-1", status: allowed ? "in_progress" : "failed" });
        await sleep(300);
        if (allowed) {
          await this.update(id, { sessionUpdate: "tool_call_update", toolCallId: "edit-1", status: "completed" });
          plan[1]!.status = "completed";
          plan[2]!.status = "in_progress";
          await this.update(id, { sessionUpdate: "plan", entries: plan });

          await this.update(id, {
            sessionUpdate: "tool_call",
            toolCallId: "exec-1",
            title: "pnpm vitest run",
            kind: "execute",
            status: "in_progress",
            rawInput: { command: "pnpm vitest run" },
          });
          await sleep(900);
          await this.update(id, {
            sessionUpdate: "tool_call_update",
            toolCallId: "exec-1",
            status: "completed",
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: " ✓ test/greet.test.ts (3 tests) 4ms\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n   Duration  412ms",
                },
              },
            ],
          });
          plan[2]!.status = "completed";
          await this.update(id, { sessionUpdate: "plan", entries: plan });
        } else {
          await this.stream(id, "agent_message_chunk", "好的，这次不改文件。下面只给出方案，你确认后我再动手。\n\n", signal);
        }
      }

      const answer = [
        s.mode === "plan" ? "## 方案（规划模式，未改动文件）\n\n" : "## 已完成\n\n",
        "把 `greet` 改得更稳了一点：\n\n",
        "- **空名字兜底**：`name` 为空或全是空格时回退到 `stranger`\n",
        "- **标点可配**：新增可选参数 `punctuation`，默认 `!`\n",
        "- 用模板字符串替换了字符串拼接\n\n",
        "```ts\nexport function greet(name: string, punctuation = \"!\") {\n  const who = name.trim() || \"stranger\";\n  return `Hello, ${who}${punctuation}`;\n}\n```\n\n",
        "| 用例 | 结果 |\n| --- | --- |\n| `greet(\"Ada\")` | `Hello, Ada!` |\n| `greet(\"  \")` | `Hello, stranger!` |\n| `greet(\"Bob\", \"?\")` | `Hello, Bob?` |\n\n",
        `当前模型 \`${s.model}\`，思考强度 \`${s.effort}\`。还要我顺手把调用方 \`src/main.ts\` 也改了吗？`,
      ].join("");
      await this.stream(id, "agent_message_chunk", answer, signal, 16);

      await this.update(id, {
        sessionUpdate: "usage_update",
        used: 18_400 + s.turns * 3_100,
        size: 200_000,
        cost: { amount: 0.012 * s.turns, currency: "USD" },
      } as never);
      return { stopReason: "end_turn" };
    } catch (error) {
      if (signal.aborted) return { stopReason: "cancelled" };
      throw error;
    } finally {
      if (s.abort === abort) s.abort = null;
    }
  }
}

export function runDemoAgent(): void {
  const input = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(input, output);
  new acp.AgentSideConnection((conn) => new DemoAgent(conn), stream);
}
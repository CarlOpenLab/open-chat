/// <reference types="vite-plus/test/globals" />

import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import { useMessageTimings } from "./useMessageTimings";

/** 构造一条 assistant 消息（id 为空串表示供应商未给 id）。 */
function assistant(
  id: string | undefined,
  status: DefaultMessageInfo<XModelMessage>["status"],
  extraInfo?: Record<string, unknown>,
): DefaultMessageInfo<XModelMessage> {
  return {
    id,
    status,
    message: { role: "assistant", content: "回答" },
    ...(extraInfo ? { extraInfo } : {}),
  };
}

const T0 = new Date("2026-01-01T00:00:00.000Z").getTime();

describe("persistMessageTimings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("回合结束时把流式起点到结束的耗时写回该条 assistant 消息", () => {
    const { persistMessageTimings } = useMessageTimings();
    const streaming = persistMessageTimings("c1", [assistant("a1", "loading")]);
    // 流式阶段只记录起点，不写 extraInfo
    expect(streaming[0].extraInfo).toBeUndefined();

    vi.setSystemTime(T0 + 2500);
    const done = persistMessageTimings("c1", [assistant("a1", "success")]);
    expect(done[0].extraInfo).toEqual({ turnStartedAtMs: T0, turnDurationMs: 2500 });
  });

  it("重新开始流式会清掉上一条持久化耗时，但保留其它 extraInfo", () => {
    const { persistMessageTimings } = useMessageTimings();
    const restarted = persistMessageTimings("c1", [
      assistant("a1", "updating", {
        turnStartedAtMs: 1,
        turnDurationMs: 9000,
        webSearchResults: [],
      }),
    ]);
    expect(restarted[0].extraInfo).toEqual({ webSearchResults: [] });

    const onlyTiming = persistMessageTimings("c1", [
      assistant("a2", "loading", { turnStartedAtMs: 1, turnDurationMs: 9000 }),
    ]);
    expect(onlyTiming[0].extraInfo).toBeUndefined();
  });

  it("本地快照丢失耗时字段后可从缓存补回，历史自带耗时不改写消息", () => {
    const { persistMessageTimings } = useMessageTimings();
    const source = [assistant("a1", "success", { turnStartedAtMs: 100, turnDurationMs: 5000 })];
    // 已带耗时：进缓存，消息与数组本身都不变（身份保持）
    expect(persistMessageTimings("c1", source)).toBe(source);

    const restored = persistMessageTimings("c1", [assistant("a1", "success")]);
    expect(restored[0].extraInfo).toEqual({ turnStartedAtMs: 100, turnDurationMs: 5000 });
  });

  it("同名 message id 在不同会话间不共享耗时缓存", () => {
    const { persistMessageTimings } = useMessageTimings();
    persistMessageTimings("c1", [assistant("dup", "loading")]);
    vi.setSystemTime(T0 + 1000);
    persistMessageTimings("c1", [assistant("dup", "success")]);

    const other = persistMessageTimings("c2", [assistant("dup", "success")]);
    expect(other[0].extraInfo).toBeUndefined();
  });

  it("空会话 key、无 id 的 assistant 与 user 消息都不参与计时", () => {
    const { persistMessageTimings } = useMessageTimings();
    const source: DefaultMessageInfo<XModelMessage>[] = [
      { id: "u1", status: "local", message: { role: "user", content: "问" } },
      assistant(undefined, "loading"),
    ];
    expect(persistMessageTimings("", source)).toBe(source);
    expect(persistMessageTimings("c1", source)).toBe(source);

    vi.setSystemTime(T0 + 1000);
    // 无 id 的消息共用 "::undefined" key 会把上一回合耗时错挂到别的消息上
    const finished = persistMessageTimings("c1", [assistant(undefined, "success")]);
    expect(finished[0].extraInfo).toBeUndefined();
  });
});

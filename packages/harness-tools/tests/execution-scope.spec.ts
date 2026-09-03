// execution-scope：invocation id 的引导期唯一性（跨重启不撞键）直测。
import { describe, expect, it } from "vitest";
import { createExecutionScope, nextInvocationId } from "../src/execution-scope";

describe("nextInvocationId", () => {
  it("单调递增且带引导期令牌（重启后不与已持久化的旧 id 撞键）", () => {
    const first = nextInvocationId();
    const second = nextInvocationId();
    // 形如 inv-<bootToken>-<seq>：bootToken 是进程启动时刻，seq 单调。
    expect(first).toMatch(/^inv-[a-z0-9]+-\d+$/);
    expect(second).toMatch(/^inv-[a-z0-9]+-\d+$/);
    expect(first).not.toBe(second);
    const seqOf = (id: string): number => Number(id.split("-").pop());
    expect(seqOf(second)).toBe(seqOf(first) + 1);
  });

  it("createExecutionScope 缺省时铸新 id，且每次调用各得其所", () => {
    const a = createExecutionScope("Task");
    const b = createExecutionScope("Task");
    expect(a.invocationId).toMatch(/^inv-/);
    expect(b.invocationId).not.toBe(a.invocationId);
    // 显式传入时不改写。
    expect(createExecutionScope("Task", "inv-fixed").invocationId).toBe("inv-fixed");
  });
});

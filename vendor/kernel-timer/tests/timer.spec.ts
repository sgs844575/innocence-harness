import { Context, FiberState } from "@innocenceharness/kernel";
import { TimerPlugin, type TimerService } from "@innocenceharness/kernel-timer";
import { afterEach, describe, expect, it, vi } from "vitest";

declare module "@innocenceharness/kernel" {
  interface Context {
    timer: TimerService;
  }
}

async function withTimer() {
  const ctx = new Context();
  const fiber = await ctx.plugin(TimerPlugin);
  return { ctx, fiber };
}

describe("kernel timer service", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a timeout once after its delay", async () => {
    vi.useFakeTimers();
    const { ctx, fiber } = await withTimer();
    let calls = 0;

    ctx.timer.setTimeout(() => { calls += 1; }, 25);
    vi.advanceTimersByTime(24);
    expect(calls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(calls).toBe(1);
    vi.advanceTimersByTime(100);
    expect(calls).toBe(1);
    expect(fiber.getEffects().filter(({ label }) => label.startsWith("timer "))).toHaveLength(0);

    await fiber.dispose();
  });

  it("fires an interval repeatedly at its delay", async () => {
    vi.useFakeTimers();
    const { ctx, fiber } = await withTimer();
    let calls = 0;

    ctx.timer.setInterval(() => { calls += 1; }, 10);
    vi.advanceTimersByTime(35);
    expect(calls).toBe(3);

    await fiber.dispose();
  });

  it("clear prevents a timeout and interval from firing", async () => {
    vi.useFakeTimers();
    const { ctx, fiber } = await withTimer();
    let timeoutCalls = 0;
    let intervalCalls = 0;

    const timeoutId = ctx.timer.setTimeout(() => { timeoutCalls += 1; }, 10);
    const intervalId = ctx.timer.setInterval(() => { intervalCalls += 1; }, 10);
    ctx.timer.clear(timeoutId);
    ctx.timer.clear(intervalId);
    expect(fiber.getEffects().filter(({ label }) => label.startsWith("timer "))).toHaveLength(0);
    vi.advanceTimersByTime(100);

    expect(timeoutCalls).toBe(0);
    expect(intervalCalls).toBe(0);
    await fiber.dispose();
  });

  it("makes clear idempotent and manages each handle with an effect", async () => {
    vi.useFakeTimers();
    const { ctx, fiber } = await withTimer();
    const id = ctx.timer.setTimeout(() => {}, 10);

    expect(fiber.getEffects().filter(({ label }) => label.startsWith("timer "))).toHaveLength(1);
    expect(() => ctx.timer.clear(id)).not.toThrow();
    expect(() => ctx.timer.clear(id)).not.toThrow();
    expect(() => ctx.timer.clear(999_999)).not.toThrow();

    await fiber.dispose();
    await fiber.dispose();
  });

  it("cancels all handles when the owning fiber is disposed", async () => {
    vi.useFakeTimers();
    const { ctx, fiber } = await withTimer();
    let timeoutCalls = 0;
    let intervalCalls = 0;

    ctx.timer.setTimeout(() => { timeoutCalls += 1; }, 10);
    ctx.timer.setInterval(() => { intervalCalls += 1; }, 10);
    await fiber.dispose();
    vi.advanceTimersByTime(100);

    expect(timeoutCalls).toBe(0);
    expect(intervalCalls).toBe(0);
    expect((ctx as { timer?: TimerService }).timer).toBeUndefined();
  });

  it("isolates callback errors without breaking the fiber or other timers", async () => {
    vi.useFakeTimers();
    const { ctx, fiber } = await withTimer();
    let failingCalls = 0;
    let healthyCalls = 0;

    ctx.timer.setInterval(() => {
      failingCalls += 1;
      throw new Error("timer callback failed");
    }, 10);
    ctx.timer.setInterval(() => { healthyCalls += 1; }, 10);

    expect(() => vi.advanceTimersByTime(10)).not.toThrow();
    expect(failingCalls).toBe(1);
    expect(healthyCalls).toBe(1);
    expect(fiber.state).toBe(FiberState.ACTIVE);

    expect(() => vi.advanceTimersByTime(20)).not.toThrow();
    expect(failingCalls).toBe(3);
    expect(healthyCalls).toBe(3);
    expect(fiber.state).toBe(FiberState.ACTIVE);
    await fiber.dispose();
  });
});

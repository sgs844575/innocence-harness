import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationDefinition } from "../src";
import { createAutomationDispatcher } from "../src";

const scheduleDefinition = (overrides: Partial<AutomationDefinition> = {}): AutomationDefinition => ({
  id: "schedule-1",
  name: "Scheduled review",
  candidate: {
    trigger: { kind: "schedule", expression: "every second", everyMs: 1_000 },
    actions: [{ kind: "review", command: "Review pending tasks" }],
    constraints: ["ask permission"],
    reviewSummary: "Review work on schedule.",
  },
  targetSessionId: "session-1",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const idleDefinition = (overrides: Partial<AutomationDefinition> = {}): AutomationDefinition => ({
  ...scheduleDefinition({ id: "idle-1", name: "Idle review" }),
  candidate: {
    trigger: { kind: "idle", expression: "after five seconds idle", idleForMs: 5_000 },
    actions: [{ kind: "review", command: "Review pending tasks" }],
    constraints: ["ask permission"],
    reviewSummary: "Review work after idle.",
  },
  ...overrides,
});

const loopDefinition = (overrides: Partial<AutomationDefinition> = {}): AutomationDefinition => ({
  ...scheduleDefinition({ id: "loop-1", name: "Loop review" }),
  loop: { loopFile: "loops/main.md", pacing: { minMs: 400, maxMs: 4_000 } },
  ...overrides,
});

describe("automation dispatcher", () => {
  afterEach(() => vi.useRealTimers());

  it("restores confirmed schedules on startup and dispatches through the controlled service", async () => {
    vi.useFakeTimers();
    const trigger = vi.fn(async () => {});
    const dispatcher = createAutomationDispatcher({
      list: () => [scheduleDefinition()],
      trigger,
      isIdle: () => false,
    });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(trigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveBeenCalledWith("schedule-1", expect.objectContaining({
      trigger: "schedule",
      sessionId: "session-1",
      routeId: "main",
      signal: expect.any(AbortSignal),
    }));

    await dispatcher.dispose();
  });

  it("dispatches only after the idle condition and configured duration both hold", async () => {
    vi.useFakeTimers();
    let idle = false;
    const trigger = vi.fn(async () => {});
    const dispatcher = createAutomationDispatcher({
      list: () => [idleDefinition()],
      trigger,
      isIdle: () => idle,
    });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(trigger).not.toHaveBeenCalled();

    idle = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(trigger).toHaveBeenCalledWith("idle-1", expect.objectContaining({ trigger: "idle", sessionId: "session-1" }));

    await dispatcher.dispose();
  });

  it("skips definitions without an explicit automatic configuration or target session", async () => {
    vi.useFakeTimers();
    const trigger = vi.fn(async () => {});
    const dispatcher = createAutomationDispatcher({
      list: () => [scheduleDefinition({
        targetSessionId: undefined,
        candidate: {
          trigger: { kind: "schedule", expression: "legacy schedule" },
          actions: [{ kind: "review", command: "Review pending tasks" }],
          constraints: ["ask permission"],
          reviewSummary: "Legacy definition.",
        } as never,
      })],
      trigger,
      isIdle: () => true,
    });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(trigger).not.toHaveBeenCalled();
    await dispatcher.dispose();
  });

  it("never overlaps automatic runs for one definition", async () => {
    vi.useFakeTimers();
    let complete: (() => void) | undefined;
    const trigger = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const dispatcher = createAutomationDispatcher({
      list: () => [scheduleDefinition()],
      trigger,
      isIdle: () => false,
    });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(trigger).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(trigger).toHaveBeenCalledOnce();
    complete?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(trigger).toHaveBeenCalledTimes(2);
    complete?.();
    await Promise.resolve();
    await dispatcher.dispose();
  });

  it("replaces schedule registrations and removes active definitions", async () => {
    vi.useFakeTimers();
    let complete: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const trigger = vi.fn((_id: string, input: { signal: AbortSignal }) => new Promise<void>((resolve) => {
      signal = input.signal;
      complete = resolve;
    }));
    const dispatcher = createAutomationDispatcher({ list: () => [], trigger, isIdle: () => false });

    dispatcher.sync([scheduleDefinition()]);
    await vi.advanceTimersByTimeAsync(500);
    dispatcher.sync([scheduleDefinition({ candidate: {
      ...scheduleDefinition().candidate,
      trigger: { kind: "schedule", expression: "every two seconds", everyMs: 2_000 },
    }, updatedAt: 2 })]);
    await vi.advanceTimersByTimeAsync(500);
    expect(trigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(trigger).toHaveBeenCalledOnce();

    dispatcher.remove("schedule-1");
    expect(signal?.aborted).toBe(true);
    complete?.();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(trigger).toHaveBeenCalledOnce();
    await dispatcher.dispose();
  });

  it("reschedules an updated definition after its active dispatch finishes", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const trigger = vi.fn<(id: string, input: { trigger: "schedule" | "idle"; sessionId: string; routeId: string; signal: AbortSignal }) => Promise<void>>(() => new Promise<void>((resolve) => { finish = resolve; }));
    const dispatcher = createAutomationDispatcher({ list: () => [], trigger, isIdle: () => true });

    const first = scheduleDefinition({ updatedAt: 1 });
    dispatcher.sync([first]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(trigger).toHaveBeenCalledOnce();
    dispatcher.sync([scheduleDefinition({
      updatedAt: 1,
      candidate: {
        trigger: { kind: "idle", expression: "after two seconds idle", idleForMs: 2_000 },
        actions: [{ kind: "review", command: "Updated review command" }],
        constraints: ["ask permission"],
        reviewSummary: "Updated idle review.",
      },
    })]);
    finish?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(trigger).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      trigger: "idle",
      sessionId: "session-1",
    }));
    finish?.();
    await Promise.resolve();
    await dispatcher.dispose();
  });

  it("waits for active dispatch cleanup during async dispose", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const trigger = vi.fn((_id: string, input: { signal: AbortSignal }) => new Promise<void>((resolve) => {
      receivedSignal = input.signal;
      finish = resolve;
    }));
    const dispatcher = createAutomationDispatcher({
      list: () => [scheduleDefinition()],
      trigger,
      isIdle: () => false,
    });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(1_000);
    const disposing = dispatcher.dispose();
    expect(receivedSignal?.aborted).toBe(true);
    let settled = false;
    void disposing.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish?.();
    await disposing;
    expect(settled).toBe(true);
  });

  it("releases timers and activity listeners, and logs no raw candidate on failure", async () => {
    vi.useFakeTimers();
    let activityListener: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const trigger = vi.fn(async () => {
      throw new Error("dispatch failed");
    });
    const log = vi.fn();
    const rawCommand = "private command --credential=secret";
    const dispatcher = createAutomationDispatcher({
      list: () => [scheduleDefinition({ candidate: {
        ...scheduleDefinition().candidate,
        actions: [{ kind: "run-command", command: rawCommand }],
      } })],
      trigger,
      isIdle: () => false,
      onActivity: (listener) => { activityListener = listener; return unsubscribe; },
      log,
    });

    dispatcher.start();
    expect(activityListener).toBeTypeOf("function");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log).toHaveBeenCalledWith("automation dispatch failed", expect.objectContaining({ id: "schedule-1", trigger: "schedule" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain(rawCommand);
    await dispatcher.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(trigger).toHaveBeenCalledOnce();
  });
});

describe("automation dispatcher loop payload and dynamic pacing", () => {
  afterEach(() => vi.useRealTimers());

  it("registers loop definitions on the schedule cadence and re-registers when the loop payload changes", async () => {
    vi.useFakeTimers();
    const trigger = vi.fn(async () => {});
    const dispatcher = createAutomationDispatcher({ list: () => [], trigger, isIdle: () => false });

    dispatcher.sync([loopDefinition()]);
    await vi.advanceTimersByTimeAsync(999);
    expect(trigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveBeenCalledOnce();

    dispatcher.sync([loopDefinition({ loop: { loopFile: "loops/other.md", pacing: { minMs: 400, maxMs: 4_000 } } })]);
    await vi.advanceTimersByTimeAsync(999);
    expect(trigger).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveBeenCalledTimes(2);

    dispatcher.sync([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(trigger).toHaveBeenCalledTimes(2);
    await dispatcher.dispose();
  });

  it("treats a loop payload change alone as a fingerprint change that restarts the timer", async () => {
    vi.useFakeTimers();
    const trigger = vi.fn(async () => {});
    const dispatcher = createAutomationDispatcher({ list: () => [], trigger, isIdle: () => false });

    dispatcher.sync([loopDefinition()]);
    await vi.advanceTimersByTimeAsync(500);
    dispatcher.sync([loopDefinition({ loop: { loopFile: "loops/other.md" } })]);
    await vi.advanceTimersByTimeAsync(500);
    expect(trigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(trigger).toHaveBeenCalledOnce();
    await dispatcher.dispose();
  });

  it("shrinks the interval after productive outcomes until clamped at minMs", async () => {
    vi.useFakeTimers();
    const trigger = vi.fn(async () => ({ productive: true }));
    const dispatcher = createAutomationDispatcher({ list: () => [loopDefinition()], trigger, isIdle: () => false });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(trigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(trigger).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(640);
    expect(trigger).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(512);
    expect(trigger).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(410);
    expect(trigger).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(400);
    expect(trigger).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(399);
    expect(trigger).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveBeenCalledTimes(7);
    await dispatcher.dispose();
  });

  it("grows the interval after unproductive outcomes until clamped at maxMs", async () => {
    vi.useFakeTimers();
    const trigger = vi.fn(async () => ({ productive: false }));
    const dispatcher = createAutomationDispatcher({ list: () => [loopDefinition()], trigger, isIdle: () => false });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(trigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(trigger).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_250);
    expect(trigger).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3_375);
    expect(trigger).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(trigger).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(trigger).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(trigger).toHaveBeenCalledTimes(6);
    await dispatcher.dispose();
  });

  it("keeps alternating outcomes bounded inside the pacing window", async () => {
    vi.useFakeTimers();
    const outcomes = [true, false, true, false, true];
    let call = 0;
    const trigger = vi.fn(async () => ({ productive: outcomes[Math.min(call++, outcomes.length - 1)] }));
    const dispatcher = createAutomationDispatcher({ list: () => [loopDefinition()], trigger, isIdle: () => false });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(trigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(trigger).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(trigger).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(960);
    expect(trigger).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1_440);
    expect(trigger).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1_152);
    expect(trigger).toHaveBeenCalledTimes(6);
    await dispatcher.dispose();
  });

  it("keeps the interval unchanged without pacing, without a loop payload, or without an outcome", async () => {
    vi.useFakeTimers();
    const outcomeTrigger = vi.fn(async () => ({ productive: false }));
    const noPacing = createAutomationDispatcher({
      list: () => [loopDefinition({ loop: { loopFile: "loops/main.md" } })],
      trigger: outcomeTrigger,
      isIdle: () => false,
    });
    noPacing.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(outcomeTrigger).toHaveBeenCalledTimes(3);
    await noPacing.dispose();

    const nonLoop = createAutomationDispatcher({ list: () => [scheduleDefinition()], trigger: outcomeTrigger, isIdle: () => false });
    nonLoop.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(outcomeTrigger).toHaveBeenCalledTimes(5);
    await nonLoop.dispose();

    const voidTrigger = vi.fn(async () => {});
    const voidOutcome = createAutomationDispatcher({ list: () => [loopDefinition()], trigger: voidTrigger, isIdle: () => false });
    voidOutcome.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(voidTrigger).toHaveBeenCalledTimes(2);
    await voidOutcome.dispose();
  });

  it("restarts pacing from the configured interval after a fingerprint change", async () => {
    vi.useFakeTimers();
    const trigger = vi.fn(async () => ({ productive: true }));
    const dispatcher = createAutomationDispatcher({ list: () => [], trigger, isIdle: () => false });

    dispatcher.sync([loopDefinition()]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(trigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(trigger).toHaveBeenCalledTimes(2);

    dispatcher.sync([loopDefinition({ loop: { loopFile: "loops/main.md", pacing: { minMs: 400, maxMs: 4_000 } }, updatedAt: 2 })]);
    await vi.advanceTimersByTimeAsync(999);
    expect(trigger).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(800);
    expect(trigger).toHaveBeenCalledTimes(4);
    await dispatcher.dispose();
  });

  it("ignores a stale outcome from an in-flight dispatch after sync rebuilds the registration", async () => {
    vi.useFakeTimers();
    let finish: ((outcome: { productive: boolean }) => void) | undefined;
    const trigger = vi.fn(() => new Promise<{ productive: boolean }>((resolve) => { finish = resolve; }));
    const dispatcher = createAutomationDispatcher({ list: () => [], trigger, isIdle: () => false });

    dispatcher.sync([loopDefinition({ updatedAt: 1 })]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(trigger).toHaveBeenCalledOnce();

    dispatcher.sync([loopDefinition({ updatedAt: 2 })]);
    finish?.({ productive: true });
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(800);
    expect(trigger).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(200);
    expect(trigger).toHaveBeenCalledTimes(2);
    finish?.({ productive: true });
    await Promise.resolve();
    await dispatcher.dispose();
  });

  it("backs off the interval when the dispatch itself rejects", async () => {
    vi.useFakeTimers();
    const trigger = vi.fn(async () => { throw new Error("session gone"); });
    const dispatcher = createAutomationDispatcher({ list: () => [loopDefinition()], trigger, isIdle: () => false });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(trigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(trigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_250);
    expect(trigger).toHaveBeenCalledTimes(3);
    await dispatcher.dispose();
  });
});

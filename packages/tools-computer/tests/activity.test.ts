import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionScope } from "@innocenceharness/harness-tools";
import { createComputerActivityStore } from "../src/activity";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function operation(sessionId = "session", controller = new AbortController()) {
  return { toolName: "computer_click", scope: createExecutionScope("computer_click", undefined, { sessionId }), signal: controller.signal };
}

describe("computer activity store", () => {
  it("aggregates concurrent sessions and preserves failure when another action succeeds", () => {
    const store = createComputerActivityStore();
    const first = store.begin(operation("one"));
    const second = store.begin(operation("two"));
    expect(store.getSnapshot()).toMatchObject({ status: "running", activeCount: 2, canStop: true });
    expect(store.activeSessionIds()).toEqual(["one", "two"]);
    first("error");
    expect(store.getSnapshot()).toMatchObject({ status: "running", activeCount: 1 });
    second("success");
    expect(store.getSnapshot()).toMatchObject({ status: "error", activeCount: 0, canStop: false });
    expect(store.activeSessionIds()).toEqual([]);
    vi.advanceTimersByTime(1400);
    expect(store.getSnapshot()).toBeNull();
    store.dispose();
  });
  it("cancels from the execution signal and ignores duplicate completion", () => {
    const store = createComputerActivityStore();
    const abort = new AbortController();
    const finish = store.begin(operation("one", abort));
    abort.abort();
    finish("success");
    expect(store.getSnapshot()?.status).toBe("cancelled");
    store.dispose();
  });
  it("keeps a new operation visible when the previous completion delay expires", () => {
    const store = createComputerActivityStore();
    store.begin(operation())("success");
    vi.advanceTimersByTime(500);
    const finish = store.begin(operation());
    vi.advanceTimersByTime(1400);
    expect(store.getSnapshot()?.status).toBe("running");
    finish("success");
    vi.advanceTimersByTime(1400);
    expect(store.getSnapshot()).toBeNull();
    store.dispose();
  });
  it("detaches listeners and timers on disposal and ignores already cancelled work", () => {
    const store = createComputerActivityStore();
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, "removeEventListener");
    const listener = vi.fn();
    store.subscribe(listener);
    const finish = store.begin(operation("one", abort));
    store.dispose();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    listener.mockClear();
    abort.abort();
    finish("success");
    store.begin(operation());
    vi.runAllTimers();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBeNull();
    const next = createComputerActivityStore();
    next.begin(operation("one", abort));
    expect(next.getSnapshot()).toBeNull();
    next.dispose();
  });
});

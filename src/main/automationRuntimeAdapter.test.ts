import { describe, expect, it, vi } from "vitest";
import type { AutomationDispatchRequest } from "@innocenceharness/harness-automation";
import { createAutomationRuntimeDispatch } from "./automationRuntimeAdapter";

const request = (signal = new AbortController().signal): AutomationDispatchRequest => ({
  automationId: "automation-1",
  candidate: {
    trigger: { kind: "idle", expression: "5m", idleForMs: 300_000 },
    actions: [{ kind: "review", command: "Review pending tasks" }],
    constraints: ["ask permission"],
    reviewSummary: "Review pending tasks after idle time.",
  },
  trigger: "idle",
  sessionId: "session-1",
  taskId: "untrusted-task",
  routeId: "untrusted-route",
  signal,
  timeoutMs: 5000,
});

describe("automation runtime dispatch adapter", () => {
  it("uses only the host-bound task identity and route when sending a confirmed definition", async () => {
    const runtime = { send: vi.fn<(input: { sessionId: string; taskId: string; routeId: string; text: string; messageId: string }) => Promise<void>>(async () => {}), stop: vi.fn() };
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: (id) => id === "session-1",
      taskRouteFor: () => ({ taskId: "task-1", routeId: "route-1" }),
    });

    await dispatch.dispatch(request());

    expect(runtime.send).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      taskId: "task-1",
      routeId: "route-1",
      messageId: expect.stringMatching(/^automation_automation-1_/),
    }));
    const sent = runtime.send.mock.calls[0]![0];
    expect(JSON.stringify(sent)).not.toContain("untrusted-task");
  });

  it("rejects an unknown session and stops the host route when its signal aborts", async () => {
    const runtime = { send: vi.fn<(input: { sessionId: string; taskId: string; routeId: string; text: string; messageId: string }) => Promise<void>>(async () => {}), stop: vi.fn() };
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => false,
      taskRouteFor: () => undefined,
    });
    await expect(dispatch.dispatch(request())).rejects.toThrow("automation session not found");

    const controller = new AbortController();
    const active = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => ({ taskId: "task-1", routeId: "route-1" }),
    });
    const done = active.dispatch(request(controller.signal));
    controller.abort();
    await done;
    expect(runtime.stop).toHaveBeenCalledWith("session-1", "route-1");
  });

  it("delivers candidate notify actions through the sink after the turn is sent", async () => {
    const runtime = { send: vi.fn(async () => {}), stop: vi.fn() };
    const notify = { send: vi.fn().mockResolvedValue(undefined) };
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => ({ taskId: "task-1", routeId: "route-1" }),
      notify,
    });
    const candidate = request();
    candidate.candidate.actions = [
      { kind: "notify", command: "任务已完成" },
      { kind: "run-command", command: "npm test" },
      { kind: "notify", command: "请查看结果" },
    ];
    await dispatch.dispatch(candidate);
    expect(notify.send).toHaveBeenCalledTimes(2);
    expect(notify.send).toHaveBeenNthCalledWith(1, { title: "自动化 automation-1 已触发", text: "任务已完成" });
    expect(notify.send).toHaveBeenNthCalledWith(2, { title: "自动化 automation-1 已触发", text: "请查看结果" });
  });

  it("skips notification without a sink and never fails the dispatch on notify errors", async () => {
    const runtime = { send: vi.fn(async () => {}), stop: vi.fn() };
    const onNotifyError = vi.fn();
    const notify = { send: vi.fn().mockRejectedValue(new Error("channel down")) };
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => undefined,
      notify,
      onNotifyError,
    });
    const candidate = request();
    candidate.candidate.actions = [{ kind: "notify", command: "任务已完成" }];
    await dispatch.dispatch(candidate);
    await vi.waitFor(() => expect(onNotifyError).toHaveBeenCalledTimes(1));
    expect(onNotifyError.mock.calls[0]![0]).toBeInstanceOf(Error);

    const silent = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => undefined,
    });
    await silent.dispatch(candidate);
  });
});

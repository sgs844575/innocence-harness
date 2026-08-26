import { describe, expect, it, vi } from "vitest";
import type { AutomationDispatchRequest } from "@innocenceharness/harness-automation";
import { createAutomationRuntimeDispatch } from "./automationRuntimeAdapter";

const request = (signal = new AbortController().signal): AutomationDispatchRequest => ({
  automationId: "automation-1",
  candidate: {
    trigger: { kind: "idle", expression: "5m" },
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
});

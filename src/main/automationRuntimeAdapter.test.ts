import { describe, expect, it, vi } from "vitest";
import type { AutomationDispatchRequest } from "@innocenceharness/harness-automation";
import { createAutomationRuntimeDispatch } from "./automationRuntimeAdapter";
import {
  appendObservedReplyDelta,
  beginObservedReply,
  endObservedReply,
  markObservedReplyError,
} from "./automationReplyObserver";

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

const loopRequest = (signal = new AbortController().signal): AutomationDispatchRequest => ({
  automationId: "automation-loop-1",
  candidate: {
    trigger: { kind: "schedule", expression: "every 5m", everyMs: 300_000 },
    actions: [
      { kind: "run-command", command: "work the checklist" },
      { kind: "notify", command: "循环已完成" },
    ],
    constraints: ["stay on the checklist"],
    reviewSummary: "Work the checklist on a schedule.",
  },
  trigger: "schedule",
  sessionId: "session-1",
  routeId: "main",
  signal,
  timeoutMs: 5000,
});

type SendInput = { sessionId: string; taskId: string; routeId: string; text: string; messageId: string };

const loopDefinitionFor = (id: string): { name: string; loopFile: string } | undefined =>
  id === "automation-loop-1" ? { name: "deploy watch", loopFile: ".innocence/loop.md" } : undefined;

describe("automation loop dispatch adapter", () => {
  it("sends an English loop envelope turn carrying the checklist path and the termination marker", async () => {
    const runtime = { send: vi.fn<(input: SendInput) => Promise<void>>(async () => {}), stop: vi.fn() };
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => ({ taskId: "task-1", routeId: "route-1" }),
      loop: { definitionFor: loopDefinitionFor, disable: vi.fn().mockResolvedValue(undefined) },
    });

    const outcome = await dispatch.dispatch(loopRequest());

    expect(runtime.send).toHaveBeenCalledTimes(1);
    const sent = runtime.send.mock.calls[0]![0];
    expect(sent.messageId).toMatch(/^automation_automation-loop-1_/);
    expect(sent.text).toContain("deploy watch");
    expect(sent.text).toContain(".innocence/loop.md");
    expect(sent.text).toContain("[loop-complete]");
    expect(sent.text).toContain("machine-triggered");
    expect(sent.text).toContain("marked done");
    expect(sent.text).toContain("skeleton");
    expect(sent.text).toContain("continue with the next entry");
    expect(sent.text).toMatch(/^[A-Za-z]/);
    // An empty reply (no deltas mirrored) counts as an idle turn.
    expect(outcome).toEqual({ productive: false });
  });

  it("falls back to the legacy controlled turn when no loop payload resolves", async () => {
    const runtime = { send: vi.fn<(input: SendInput) => Promise<void>>(async () => {}), stop: vi.fn() };
    const disable = vi.fn().mockResolvedValue(undefined);
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => undefined,
      loop: { definitionFor: () => undefined, disable },
    });

    const outcome = await dispatch.dispatch(request());

    const sent = runtime.send.mock.calls[0]![0];
    expect(sent.text).toBe("受控自动化：review: Review pending tasks");
    expect(outcome).toBeUndefined();
    expect(disable).not.toHaveBeenCalled();
  });

  it("disables the definition and delivers the completion notify when the reply carries the termination marker on its own line", async () => {
    const runtime = {
      send: vi.fn<(input: SendInput) => Promise<void>>(async (input) => {
        appendObservedReplyDelta(input.messageId, "\n  [loop-complete]  \n");
      }),
      stop: vi.fn(),
    };
    const disable = vi.fn<(automationId: string) => Promise<void>>().mockResolvedValue(undefined);
    const notify = { send: vi.fn().mockResolvedValue(undefined) };
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => ({ taskId: "task-1", routeId: "route-1" }),
      notify,
      loop: { definitionFor: loopDefinitionFor, disable },
    });

    const outcome = await dispatch.dispatch(loopRequest());

    expect(outcome).toEqual({ productive: true });
    expect(disable).toHaveBeenCalledTimes(1);
    expect(disable).toHaveBeenCalledWith("automation-loop-1");
    expect(notify.send).toHaveBeenCalledTimes(1);
    expect(notify.send).toHaveBeenCalledWith({ title: "自动化 automation-loop-1 已完成", text: "循环已完成" });
  });

  it("backs off an errored turn even when mirrored warning text and the marker were collected", async () => {
    const runtime = {
      send: vi.fn<(input: SendInput) => Promise<void>>(async (input) => {
        appendObservedReplyDelta(input.messageId, "\n\n> ⚠️ provider stream failed\n");
        appendObservedReplyDelta(input.messageId, "[loop-complete]");
        markObservedReplyError(input.messageId, "provider stream failed");
      }),
      stop: vi.fn(),
    };
    const disable = vi.fn<(automationId: string) => Promise<void>>().mockResolvedValue(undefined);
    const notify = { send: vi.fn().mockResolvedValue(undefined) };
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => ({ taskId: "task-1", routeId: "route-1" }),
      notify,
      loop: { definitionFor: loopDefinitionFor, disable },
    });

    const outcome = await dispatch.dispatch(loopRequest());

    expect(outcome).toEqual({ productive: false });
    expect(disable).not.toHaveBeenCalled();
    expect(notify.send).not.toHaveBeenCalled();
  });

  it("treats a turn whose only text is the mirrored compaction notice as idle", async () => {
    const runtime = {
      send: vi.fn<(input: SendInput) => Promise<void>>(async (input) => {
        appendObservedReplyDelta(input.messageId, "\n\n> 🗜️ 已压缩较早的对话历史\n");
      }),
      stop: vi.fn(),
    };
    const disable = vi.fn<(automationId: string) => Promise<void>>().mockResolvedValue(undefined);
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => ({ taskId: "task-1", routeId: "route-1" }),
      loop: { definitionFor: loopDefinitionFor, disable },
    });

    const outcome = await dispatch.dispatch(loopRequest());

    expect(outcome).toEqual({ productive: false });
    expect(disable).not.toHaveBeenCalled();
  });

  it("does not complete when the marker is referenced inside prose", async () => {
    const runtime = {
      send: vi.fn<(input: SendInput) => Promise<void>>(async (input) => {
        appendObservedReplyDelta(input.messageId, "Will reply [loop-complete] once the list is finished.");
      }),
      stop: vi.fn(),
    };
    const disable = vi.fn<(automationId: string) => Promise<void>>().mockResolvedValue(undefined);
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => ({ taskId: "task-1", routeId: "route-1" }),
      loop: { definitionFor: loopDefinitionFor, disable },
    });

    const outcome = await dispatch.dispatch(loopRequest());

    expect(outcome).toEqual({ productive: true });
    expect(disable).not.toHaveBeenCalled();
  });

  it("reports a productive outcome without disabling for a non-empty reply without the marker", async () => {
    const runtime = {
      send: vi.fn<(input: SendInput) => Promise<void>>(async (input) => {
        appendObservedReplyDelta(input.messageId, "ticked one entry off");
      }),
      stop: vi.fn(),
    };
    const disable = vi.fn<(automationId: string) => Promise<void>>().mockResolvedValue(undefined);
    const notify = { send: vi.fn().mockResolvedValue(undefined) };
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => ({ taskId: "task-1", routeId: "route-1" }),
      notify,
      loop: { definitionFor: loopDefinitionFor, disable },
    });

    const outcome = await dispatch.dispatch(loopRequest());

    expect(outcome).toEqual({ productive: true });
    expect(disable).not.toHaveBeenCalled();
    expect(notify.send).not.toHaveBeenCalled();
  });

  it("keeps the productive outcome and stays observable when disabling fails", async () => {
    const runtime = {
      send: vi.fn<(input: SendInput) => Promise<void>>(async (input) => {
        appendObservedReplyDelta(input.messageId, "[loop-complete]");
      }),
      stop: vi.fn(),
    };
    const onDisableError = vi.fn();
    const dispatch = createAutomationRuntimeDispatch({
      runtime,
      sessionExists: () => true,
      taskRouteFor: () => ({ taskId: "task-1", routeId: "route-1" }),
      loop: {
        definitionFor: loopDefinitionFor,
        disable: vi.fn<(automationId: string) => Promise<void>>().mockRejectedValue(new Error("store down")),
        onDisableError,
      },
    });

    const outcome = await dispatch.dispatch(loopRequest());

    expect(outcome).toEqual({ productive: true });
    expect(onDisableError).toHaveBeenCalledTimes(1);
    expect(onDisableError.mock.calls[0]![0]).toBeInstanceOf(Error);
  });
});

describe("automation reply observer", () => {
  it("collects only the deltas of begun message ids", () => {
    appendObservedReplyDelta("unseen-message", "ignored");
    beginObservedReply("observed-message");
    appendObservedReplyDelta("observed-message", "one ");
    appendObservedReplyDelta("observed-message", "two");
    expect(endObservedReply("observed-message")).toEqual({ text: "one two", errored: false });
    expect(endObservedReply("observed-message")).toEqual({ text: "", errored: false });
    expect(endObservedReply("never-begun")).toEqual({ text: "", errored: false });
  });

  it("keeps the complete error of a begun id and ignores errors of unknown ids", () => {
    markObservedReplyError("unmarked-message", "ignored error");
    beginObservedReply("marked-message");
    appendObservedReplyDelta("marked-message", "partial text");
    markObservedReplyError("marked-message", "complete provider diagnostic");
    expect(endObservedReply("marked-message")).toEqual({
      text: "partial text",
      errored: true,
      error: "complete provider diagnostic",
    });
  });
});

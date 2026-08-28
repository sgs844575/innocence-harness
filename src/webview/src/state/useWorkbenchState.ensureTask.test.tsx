// @vitest-environment jsdom
// C1 (final review): the task:start channel populates the workbench. The
// hook's ensureTask calls taskApi.start and installs the returned task
// through loadTask (getTask + listRoutes) — session activation probes with
// create:false, the first send creates with create:true.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const taskApiMock = vi.hoisted(() => ({
  start: vi.fn<(request: unknown) => Promise<unknown>>(),
  getTask: vi.fn<(request: unknown) => Promise<unknown>>(),
  listRoutes: vi.fn<(request: unknown) => Promise<unknown>>(),
  onTaskEvent: vi.fn<() => () => void>(() => () => {}),
  onTaskNotice: vi.fn<() => () => void>(() => () => {}),
}));

vi.mock("../lib/ipc", () => ({ taskApi: taskApiMock }));

import { useWorkbenchState } from "./useWorkbenchState";

const taskView = {
  taskId: "t1",
  sessionId: "s1",
  status: "ready",
  activeRouteId: "main",
  mode: "baseline",
  workspaceKind: "git",
  version: "evt_1",
  gitBranch: null,
  routeId: "main",
};

const routes = {
  routes: [
    { routeId: "main", parentRouteId: null, forkTurnId: null, checkpointId: "ckpt_1", workspaceKind: "git" },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useWorkbenchState.ensureTask (C1)", () => {
  it("installs the started task through loadTask (getTask + listRoutes)", async () => {
    taskApiMock.start.mockResolvedValue(taskView);
    taskApiMock.getTask.mockResolvedValue(taskView);
    taskApiMock.listRoutes.mockResolvedValue(routes);

    const { result } = renderHook(() => useWorkbenchState({ sessionId: "s1" }));
    expect(result.current.state.task).toBeNull();

    await act(async () => {
      await result.current.ensureTask("s1");
    });

    expect(taskApiMock.start).toHaveBeenCalledWith({ sessionId: "s1", create: true });
    expect(taskApiMock.getTask).toHaveBeenCalledWith({ taskId: "t1" });
    expect(taskApiMock.listRoutes).toHaveBeenCalledWith({ taskId: "t1" });
    expect(result.current.state.task).toMatchObject({
      taskId: "t1",
      sessionId: "s1",
      expectedVersion: "evt_1",
      routes: [{ routeId: "main", checkpointId: "ckpt_1" }],
    });
    expect(result.current.state.activeRouteId).toBe("main");
    expect(result.current.activeTask).toEqual({ taskId: "t1", routeId: "main" });

    // Short-circuit: the same session does not re-start.
    await act(async () => {
      await result.current.ensureTask("s1");
    });
    expect(taskApiMock.start).toHaveBeenCalledTimes(1);
  });

  it("create:false probes and leaves the workbench empty when the session has no task", async () => {
    taskApiMock.start.mockResolvedValue(null);

    const { result } = renderHook(() => useWorkbenchState({ sessionId: "s1" }));
    await act(async () => {
      await result.current.ensureTask("s1", false);
    });

    expect(taskApiMock.start).toHaveBeenCalledWith({ sessionId: "s1", create: false });
    expect(result.current.state.task).toBeNull();
    expect(taskApiMock.getTask).not.toHaveBeenCalled();
  });

  it("does not install a task started for an old session after switching sessions", async () => {
    let resolveStart: ((value: typeof taskView) => void) | undefined;
    taskApiMock.start.mockReturnValue(new Promise<typeof taskView>((resolve) => { resolveStart = resolve; }));
    taskApiMock.getTask.mockResolvedValue(taskView);
    taskApiMock.listRoutes.mockResolvedValue(routes);

    const { result, rerender } = renderHook(({ sessionId }) => useWorkbenchState({ sessionId }), {
      initialProps: { sessionId: "s1" as string | null },
    });
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.ensureTask("s1"); });
    rerender({ sessionId: "s2" });
    resolveStart?.(taskView);
    await act(async () => { await pending; });

    expect(result.current.state.sessionId).toBe("s2");
    expect(result.current.state.task).toBeNull();
  });

  it("does not install a task loaded for an old session after switching sessions", async () => {
    taskApiMock.getTask.mockReturnValue(new Promise<typeof taskView>((resolve) => {
      setTimeout(() => resolve(taskView), 0);
    }));
    taskApiMock.listRoutes.mockResolvedValue(routes);
    const { result, rerender } = renderHook(({ sessionId }) => useWorkbenchState({ sessionId }), {
      initialProps: { sessionId: "s1" as string | null },
    });
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.loadTask("t1"); });
    rerender({ sessionId: "s2" });
    await act(async () => { await pending; });

    expect(result.current.state.sessionId).toBe("s2");
    expect(result.current.state.task).toBeNull();
  });

  // 落地创建（首条消息）：useChatStream.send 在 await ensureSession() 后同一
  // 微任务内调用 ensureTask，React 尚未提交新 activeId（ref 仍为 null）。
  it("starts the task with create:true when called before React commits the landing session", async () => {
    let resolveStart: ((value: typeof taskView) => void) | undefined;
    taskApiMock.start.mockReturnValue(new Promise<typeof taskView>((resolve) => { resolveStart = resolve; }));
    taskApiMock.getTask.mockResolvedValue(taskView);
    taskApiMock.listRoutes.mockResolvedValue(routes);

    const { result, rerender } = renderHook(({ sessionId }) => useWorkbenchState({ sessionId }), {
      initialProps: { sessionId: null as string | null },
    });
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.ensureTask("s1"); });

    expect(taskApiMock.start).toHaveBeenCalledWith({ sessionId: "s1", create: true });

    // 提交发生在 task:start 往返期间：ref null → s1 且代际 +1（提交步）。
    rerender({ sessionId: "s1" });
    resolveStart?.(taskView);
    await act(async () => { await pending; });

    expect(result.current.state.sessionId).toBe("s1");
    expect(result.current.state.task).toMatchObject({ taskId: "t1", sessionId: "s1" });
    expect(result.current.activeTask).toEqual({ taskId: "t1", routeId: "main" });
  });

  it("still installs the landing task when React commits during the post-start load", async () => {
    taskApiMock.start.mockResolvedValue(taskView);
    let resolveGetTask: ((value: typeof taskView) => void) | undefined;
    taskApiMock.getTask.mockReturnValue(new Promise<typeof taskView>((resolve) => { resolveGetTask = resolve; }));
    taskApiMock.listRoutes.mockResolvedValue(routes);

    const { result, rerender } = renderHook(({ sessionId }) => useWorkbenchState({ sessionId }), {
      initialProps: { sessionId: null as string | null },
    });
    let pending: Promise<void> | undefined;
    await act(async () => { pending = result.current.ensureTask("s1"); });

    // 提交发生在 loadTask（getTask/listRoutes）往返期间。
    rerender({ sessionId: "s1" });
    resolveGetTask?.(taskView);
    await act(async () => { await pending; });

    expect(result.current.state.task).toMatchObject({ taskId: "t1", sessionId: "s1" });
  });

  it("does not install a landing task when the user switches to another session before commit", async () => {
    let resolveStart: ((value: typeof taskView) => void) | undefined;
    taskApiMock.start.mockReturnValue(new Promise<typeof taskView>((resolve) => { resolveStart = resolve; }));
    taskApiMock.getTask.mockResolvedValue(taskView);
    taskApiMock.listRoutes.mockResolvedValue(routes);

    const { result, rerender } = renderHook(({ sessionId }) => useWorkbenchState({ sessionId }), {
      initialProps: { sessionId: null as string | null },
    });
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.ensureTask("s1"); });
    // 用户在提交前切到既有会话 s2：落地目标不是 s1，任务不得安装。
    rerender({ sessionId: "s2" });
    resolveStart?.(taskView);
    await act(async () => { await pending; });

    expect(result.current.state.sessionId).toBe("s2");
    expect(result.current.state.task).toBeNull();
  });
});

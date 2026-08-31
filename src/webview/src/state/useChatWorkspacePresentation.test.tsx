// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../../shared/ipc";
import { useChatWorkspacePresentation } from "./useChatWorkspacePresentation";

const task = {
  taskId: "task-1",
  sessionId: "session-1",
  status: "running",
  mode: "default",
  workspaceKind: "git",
  gitBranch: "main",
  routes: [{
    routeId: "main",
    parentRouteId: null,
    forkTurnId: null,
    checkpointId: "checkpoint-1",
    workspaceKind: "git",
  }],
  expectedVersion: "v1",
};

const assistantMessage: ChatMessage = {
  id: "assistant-1",
  role: "assistant",
  createdAt: 1,
  parts: [{ type: "text", text: "已完成" }],
};

const baseInput = {
  messages: [assistantMessage],
  streaming: false,
  task,
  activeRouteId: "main",
  hunks: [],
  changedFiles: ["logo.png"],
  terminal: { durationMs: 0, backgroundTasks: 0 },
  agentName: "default",
  onCompare: vi.fn(),
  onOpenProcess: vi.fn(),
  onOpenTerminal: vi.fn(),
};

afterEach(cleanup);

describe("useChatWorkspacePresentation", () => {
  it("creates a file-level task change card when hunks are empty", () => {
    const { result } = renderHook(() => useChatWorkspacePresentation(baseInput));

    expect(result.current.taskChanges?.["assistant-1"]).toMatchObject({
      summary: { fileCount: 1, added: 0, removed: 0 },
      checkpointId: "checkpoint-1",
    });
    // environment 契约：分支可检测 + 有变更 → 显示。
    expect(result.current.activity.environment).toMatchObject({ changedFiles: 1, branch: "main" });
  });

  it("keeps the environment section visible with an undetected branch fallback", () => {
    const { result } = renderHook(() => useChatWorkspacePresentation({
      ...baseInput,
      task: { ...task, gitBranch: null },
    }));

    // environment 契约（Git 工具始终可见）：分支不可检测时 Git 段仍渲染，
    // 分支回落 null（胶囊内显示「未检测」），变更计数照常上报。
    expect(result.current.activity.environment).toMatchObject({ changedFiles: 1, branch: null });
  });

  it("does not use streaming text as a process when TodoWrite is absent", () => {
    const { result } = renderHook(() => useChatWorkspacePresentation({
      ...baseInput,
      changedFiles: [],
      task: null,
      streaming: true,
    }));

    expect(result.current.activity.process).toBeUndefined();
  });
});

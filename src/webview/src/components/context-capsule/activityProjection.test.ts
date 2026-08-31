import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../../shared/ipc";
import { agentActivityFromWorkspace, processActivityFromMessages } from "./activityProjection";

describe("processActivityFromMessages", () => {
  it("projects the latest host tool todo state without counting chat messages", () => {
    const messages: ChatMessage[] = [{
      id: "assistant",
      role: "assistant",
      createdAt: 1,
      parts: [{
        type: "toolCall",
        id: "todo",
        toolName: "TodoWrite",
        args: {
          todos: [
            { content: "Done", status: "completed", priority: "high" },
            { content: "Current", status: "in_progress", priority: "high" },
            { content: "Later", status: "pending", priority: "low" },
          ],
        },
      }],
    }];

    expect(processActivityFromMessages(messages, "fallback")).toEqual({
      todos: [
        { content: "Done", status: "completed" },
        { content: "Current", status: "in_progress" },
        { content: "Later", status: "pending" },
      ],
      completed: 1,
      total: 3,
      current: "Current",
      pending: 1,
    });
  });

  it("rejects a mixed valid and invalid TodoWrite atomically", () => {
    const messages: ChatMessage[] = [{
      id: "assistant",
      role: "assistant",
      createdAt: 1,
      parts: [{
        type: "toolCall",
        id: "todo",
        toolName: "TodoWrite",
        args: {
          todos: [
            { content: "Keep me", status: "pending", priority: "high" },
            { content: "Reject me", status: "blocked", priority: "low" },
          ],
        },
      }],
    }];

    expect(processActivityFromMessages(messages, "fallback")).toBeUndefined();
  });

  it.each([
    ["missing priority", { content: "No priority", status: "pending" }],
    ["blank content", { content: "  \t", status: "pending", priority: "high" }],
    ["invalid status", { content: "Bad status", status: "blocked", priority: "high" }],
  ])("rejects TodoWrite with %s", (_name, invalidTodo) => {
    const messages: ChatMessage[] = [{
      id: "assistant",
      role: "assistant",
      createdAt: 1,
      parts: [{
        type: "toolCall",
        id: "todo",
        toolName: "TodoWrite",
        args: { todos: [invalidTodo] },
      }],
    }];

    expect(processActivityFromMessages(messages, "fallback")).toBeUndefined();
  });

  it("does not let a mixed invalid TodoWrite overwrite an older valid list", () => {
    const messages: ChatMessage[] = [{
      id: "assistant",
      role: "assistant",
      createdAt: 1,
      parts: [{
        type: "toolCall",
        id: "older",
        toolName: "TodoWrite",
        args: { todos: [{ content: "旧任务", status: "in_progress", priority: "high" }] },
      }, {
        type: "toolCall",
        id: "latest",
        toolName: "TodoWrite",
        args: {
          todos: [
            { content: "新任务", status: "pending", priority: "medium" },
            { content: "坏任务", status: "pending" },
          ],
        },
      }],
    }];

    expect(processActivityFromMessages(messages, "Waiting")).toMatchObject({
      todos: [{ content: "旧任务", status: "in_progress" }],
      total: 1,
    });
  });

  it("does not project Todo state from an unassociated tool result", () => {
    const messages: ChatMessage[] = [{
      id: "assistant",
      role: "assistant",
      createdAt: 1,
      parts: [{
        type: "toolResult",
        toolCallId: "todo",
        content: '{"todos":[{"content":"假的清单","status":"pending","priority":"high"}]}',
        isError: false,
      }],
    }];

    expect(processActivityFromMessages(messages, "fallback")).toBeUndefined();
  });

  it("renders the Git panel with null branch when no task, branch, or changes are available", () => {
    const projection = agentActivityFromWorkspace({
      task: null,
      changedFiles: [],
      changeSummary: { added: 0, removed: 0 },
      process: undefined,
      terminal: { durationMs: 0, backgroundTasks: 0 },
      agentName: "default",
      streaming: true,
      onCompare: () => undefined,
    });

    // Git 段始终显示（无任务 → 兜底），让胶囊 Git 工具面板在所有会话都可见
    expect(projection.environment).toEqual({
      branch: null,
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      workspaceKind: "git",
      onCompare: expect.any(Function),
    });
    expect(projection.terminal).toBeUndefined();
  });

  it("keeps the Git panel visible for file-level changes with a null branch and shows a live terminal", () => {
    const projection = agentActivityFromWorkspace({
      task: { gitBranch: null, workspaceKind: "git" },
      changedFiles: ["image.png"],
      changeSummary: { added: 0, removed: 0 },
      process: undefined,
      terminal: { durationMs: 30_000, backgroundTasks: 1 },
      agentName: "default",
      streaming: false,
      onCompare: () => undefined,
    });

    expect(projection.environment).toEqual({
      branch: null,
      changedFiles: 1,
      additions: 0,
      deletions: 0,
      workspaceKind: "git",
      onCompare: expect.any(Function),
    });
    expect(projection.terminal).toEqual({ durationMs: 30_000, backgroundTasks: 1 });
  });

  it("still renders the Git panel when the task exists but the branch is undetectable and nothing changed", () => {
    const projection = agentActivityFromWorkspace({
      task: { gitBranch: null, workspaceKind: "git" },
      changedFiles: [],
      changeSummary: { added: 0, removed: 0 },
      process: undefined,
      terminal: { durationMs: 0, backgroundTasks: 0 },
      agentName: "default",
      streaming: true,
      onCompare: () => undefined,
    });

    expect(projection.environment).toEqual({
      branch: null,
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      workspaceKind: "git",
      onCompare: expect.any(Function),
    });
  });

  it("still renders the Git panel when a branch is detectable but there are no changed files", () => {
    const projection = agentActivityFromWorkspace({
      task: { gitBranch: "main", workspaceKind: "git" },
      changedFiles: [],
      changeSummary: { added: 0, removed: 0 },
      process: undefined,
      terminal: { durationMs: 0, backgroundTasks: 0 },
      agentName: "default",
      streaming: true,
      onCompare: () => undefined,
    });

    expect(projection.environment).toEqual({
      branch: "main",
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      workspaceKind: "git",
      onCompare: expect.any(Function),
    });
  });
  it("combines existing task, review, terminal, chat, and settings state without owning them", () => {
    const onCompare = () => undefined;
    expect(agentActivityFromWorkspace({
      task: { gitBranch: "main", workspaceKind: "git" },
      changedFiles: ["a.ts", "b.ts"],
      changeSummary: { added: 7, removed: 3 },
      process: { completed: 1, total: 3, current: "Current", pending: 1 },
      terminal: { durationMs: 30_000, backgroundTasks: 1 },
      agentName: "default",
      streaming: true,
      onCompare,
    })).toEqual({
      environment: {
        branch: "main",
        changedFiles: 2,
        additions: 7,
        deletions: 3,
        workspaceKind: "git",
        onCompare,
      },
      process: { completed: 1, total: 3, current: "Current", pending: 1 },
      terminal: { durationMs: 30_000, backgroundTasks: 1 },
      agent: { name: "default", status: "running" },
    });
  });

  it("treats the latest valid empty TodoWrite as an empty process instead of retaining an older plan", () => {
    const messages: ChatMessage[] = [{
      id: "assistant",
      role: "assistant",
      createdAt: 1,
      parts: [
        {
          type: "toolCall",
          id: "older",
          toolName: "TodoWrite",
          args: { todos: [{ content: "Stale work", status: "in_progress" }] },
        },
        { type: "toolCall", id: "latest", toolName: "TodoWrite", args: { todos: [] } },
      ],
    }];

    expect(processActivityFromMessages(messages, "Waiting")).toEqual({
      todos: [],
      completed: 0,
      total: 0,
      current: "Waiting",
      pending: 0,
    });
  });

  it("keeps workspace kind distinct and maps canonical waiting, failure, and archived activity", () => {
    const base = {
      task: { gitBranch: "main", workspaceKind: "snapshot", status: "checkpoint-failed" },
      changedFiles: [],
      changeSummary: { added: 0, removed: 0 },
      process: { todos: [], completed: 0, total: 0, current: "Waiting", pending: 0 },
      terminal: { durationMs: 0, backgroundTasks: 0 },
      agentName: "default",
      streaming: true,
      onCompare: () => undefined,
    } as unknown as Parameters<typeof agentActivityFromWorkspace>[0];

    expect(agentActivityFromWorkspace({ ...base, sessionStatus: "waiting-permission" }).agent.status).toBe("waiting-permission");
    expect(agentActivityFromWorkspace(base).agent.status).toBe("failed");
    expect(agentActivityFromWorkspace({ ...base, sessionStatus: "archived" }).agent.status).toBe("archived");
    // Git 段始终渲染：分支可检测 + 0 变更 → environment 段存在、additions/deletions=0
    expect(agentActivityFromWorkspace(base).environment).toEqual({
      branch: "main",
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      workspaceKind: "snapshot",
      onCompare: expect.any(Function),
    });
  });
});

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
      completed: 1,
      total: 3,
      current: "Current",
      pending: 1,
    });
  });

  it("uses an explicit fallback when no todo tool state exists", () => {
    expect(processActivityFromMessages([], "Waiting")).toEqual({
      completed: 0,
      total: 0,
      current: "Waiting",
      pending: 0,
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
      process: { completed: 0, total: 0, current: "Waiting", pending: 0 },
      terminal: { durationMs: 0, backgroundTasks: 0 },
      agentName: "default",
      streaming: true,
      onCompare: () => undefined,
    } as unknown as Parameters<typeof agentActivityFromWorkspace>[0];

    expect(agentActivityFromWorkspace({ ...base, permissionPending: true }).agent.status).toBe("waiting-permission");
    expect(agentActivityFromWorkspace(base).agent.status).toBe("failed");
    expect(agentActivityFromWorkspace({ ...base, sessionStatus: "archived" }).agent.status).toBe("archived");
    expect(agentActivityFromWorkspace(base).environment).toMatchObject({ workspaceKind: "snapshot" });
  });
});

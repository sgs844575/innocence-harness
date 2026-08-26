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
        workspaceStatus: "git",
        onCompare,
      },
      process: { completed: 1, total: 3, current: "Current", pending: 1 },
      terminal: { durationMs: 30_000, backgroundTasks: 1 },
      agent: { name: "default", status: "running" },
    });
  });
});

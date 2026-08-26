import type { ChatMessage } from "../../../../shared/ipc";

export type AgentActivityStatus = "idle" | "running" | "waiting-permission" | "failed" | "archived";

export interface ProcessActivity {
  completed: number;
  total: number;
  current: string;
  pending: number;
}

export interface AgentActivityProjection {
  environment: {
    branch: string | null;
    changedFiles: number;
    additions: number;
    deletions: number;
    workspaceKind: string;
    onCompare?: () => void;
  };
  process: ProcessActivity & { onOpen?: () => void };
  terminal: { durationMs: number; backgroundTasks: number; onOpen?: () => void };
  agent: { name: string; status: AgentActivityStatus };
}

interface TodoView {
  content: string;
  status: string;
}

function agentStatus(input: {
  taskStatus?: string;
  sessionStatus?: AgentActivityStatus;
  streaming: boolean;
}): AgentActivityStatus {
  if (input.sessionStatus === "archived" || input.taskStatus === "archived") return "archived";
  if (input.sessionStatus === "waiting-permission") return "waiting-permission";
  if (input.sessionStatus === "failed" || input.taskStatus === "checkpoint-failed" || input.taskStatus === "interrupted") return "failed";
  if (input.streaming || input.sessionStatus === "running" || input.taskStatus === "running") return "running";
  return "idle";
}

export function agentActivityFromWorkspace(input: {
  task: { gitBranch: string | null; workspaceKind: string; status?: string } | null;
  changedFiles: readonly string[];
  changeSummary: { added: number; removed: number };
  process: ProcessActivity;
  terminal: { durationMs: number; backgroundTasks: number };
  agentName: string;
  streaming: boolean;
  sessionStatus?: AgentActivityStatus;
  onCompare: () => void;
  onOpenProcess?: () => void;
  onOpenTerminal?: () => void;
}): AgentActivityProjection {
  return {
    environment: {
      branch: input.task?.gitBranch ?? null,
      changedFiles: input.changedFiles.length,
      additions: input.changeSummary.added,
      deletions: input.changeSummary.removed,
      workspaceKind: input.task?.workspaceKind ?? "unknown",
      ...(input.task ? { onCompare: input.onCompare } : {}),
    },
    process: { ...input.process, ...(input.onOpenProcess ? { onOpen: input.onOpenProcess } : {}) },
    terminal: { ...input.terminal, ...(input.onOpenTerminal ? { onOpen: input.onOpenTerminal } : {}) },
    agent: {
      name: input.agentName,
      status: agentStatus({
        taskStatus: input.task?.status,
        sessionStatus: input.sessionStatus,
        streaming: input.streaming,
      }),
    },
  };
}

export function processActivityFromMessages(messages: readonly ChatMessage[], fallback: string): ProcessActivity {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const parts = messages[messageIndex].parts;
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part.type !== "toolCall" || part.toolName !== "TodoWrite") continue;
      const todos = readTodos(part.args.todos);
      if (todos === undefined) continue;
      const current = todos.find((todo) => todo.status === "in_progress")?.content ?? fallback;
      return {
        completed: todos.filter((todo) => todo.status === "completed").length,
        total: todos.length,
        current,
        pending: todos.filter((todo) => todo.status === "pending").length,
      };
    }
  }
  return { completed: 0, total: 0, current: fallback, pending: 0 };
}

function readTodos(value: unknown): TodoView[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is TodoView =>
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as TodoView).content === "string" &&
    typeof (entry as TodoView).status === "string",
  );
}

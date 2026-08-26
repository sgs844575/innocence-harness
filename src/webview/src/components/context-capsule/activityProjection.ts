import type { ChatMessage } from "../../../../shared/ipc";

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
    workspaceStatus: string;
    onCompare?: () => void;
  };
  process: ProcessActivity & { onOpen?: () => void };
  terminal: { durationMs: number; backgroundTasks: number; onOpen?: () => void };
  agent: { name: string; status: string };
}

interface TodoView {
  content: string;
  status: string;
}

export function agentActivityFromWorkspace(input: {
  task: { gitBranch: string | null; workspaceKind: string } | null;
  changedFiles: readonly string[];
  changeSummary: { added: number; removed: number };
  process: ProcessActivity;
  terminal: { durationMs: number; backgroundTasks: number };
  agentName: string;
  streaming: boolean;
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
      workspaceStatus: input.task?.workspaceKind ?? "local",
      ...(input.task ? { onCompare: input.onCompare } : {}),
    },
    process: { ...input.process, ...(input.onOpenProcess ? { onOpen: input.onOpenProcess } : {}) },
    terminal: { ...input.terminal, ...(input.onOpenTerminal ? { onOpen: input.onOpenTerminal } : {}) },
    agent: { name: input.agentName, status: input.streaming ? "running" : "idle" },
  };
}

export function processActivityFromMessages(messages: readonly ChatMessage[], fallback: string): ProcessActivity {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const parts = messages[messageIndex].parts;
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part.type !== "toolCall" || part.toolName !== "TodoWrite") continue;
      const todos = readTodos(part.args.todos);
      if (todos.length === 0) continue;
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

function readTodos(value: unknown): TodoView[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is TodoView =>
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as TodoView).content === "string" &&
    typeof (entry as TodoView).status === "string",
  );
}

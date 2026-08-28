import type { ChatMessage, SubagentLifecycleEvent } from "../../../../shared/ipc";

export type AgentActivityStatus = "idle" | "running" | "waiting-permission" | "failed" | "archived";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoView {
  content: string;
  status: TodoStatus;
}

export interface ProcessActivity {
  todos?: TodoView[];
  completed: number;
  total: number;
  current: string;
  pending: number;
}

export interface SubagentActivityView {
  childId: string;
  description: string;
  status: SubagentLifecycleEvent["status"];
  text: string;
  error?: string;
}

export interface AgentActivityProjection {
  environment?: {
    branch: string | null;
    changedFiles: number;
    additions: number;
    deletions: number;
    workspaceKind: string;
    onCompare?: () => void;
  };
  process?: ProcessActivity & { onOpen?: () => void };
  terminal?: { durationMs: number; backgroundTasks: number; onOpen?: () => void };
  agent: {
    name: string;
    status: AgentActivityStatus;
    subagents?: readonly SubagentActivityView[];
    onOpenSubagent?: (childId: string) => void;
  };
}

interface TodoInput {
  content: unknown;
  status: unknown;
  priority: unknown;
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
  process?: ProcessActivity;
  terminal: { durationMs: number; backgroundTasks: number };
  agentName: string;
  streaming: boolean;
  sessionStatus?: AgentActivityStatus;
  onCompare: () => void;
  onOpenProcess?: () => void;
  onOpenTerminal?: () => void;
  subagents?: readonly SubagentActivityView[];
  onOpenSubagent?: (childId: string) => void;
}): AgentActivityProjection {
  // 项目不存在 git（分支不可检测）或没有变更时隐藏 environment 段：
  // branch 为空时展示的“未检测”空壳没有信息量，宁可整段隐藏。
  const hasEnvironment = Boolean(input.task?.gitBranch) && input.changedFiles.length > 0;
  const hasTerminal = input.terminal.backgroundTasks > 0;
  return {
    ...(hasEnvironment ? {
      environment: {
        branch: input.task?.gitBranch ?? null,
        changedFiles: input.changedFiles.length,
        additions: input.changeSummary.added,
        deletions: input.changeSummary.removed,
        workspaceKind: input.task?.workspaceKind ?? "unknown",
        ...(input.task ? { onCompare: input.onCompare } : {}),
      },
    } : {}),
    ...(input.process ? {
      process: { ...input.process, ...(input.onOpenProcess ? { onOpen: input.onOpenProcess } : {}) },
    } : {}),
    ...(hasTerminal ? {
      terminal: { ...input.terminal, ...(input.onOpenTerminal ? { onOpen: input.onOpenTerminal } : {}) },
    } : {}),
    agent: {
      name: input.agentName,
      status: agentStatus({
        taskStatus: input.task?.status,
        sessionStatus: input.sessionStatus,
        streaming: input.streaming,
      }),
      ...(input.subagents && input.subagents.length > 0 ? { subagents: input.subagents } : {}),
      ...(input.onOpenSubagent ? { onOpenSubagent: input.onOpenSubagent } : {}),
    },
  };
}

export function processActivityFromMessages(messages: readonly ChatMessage[], fallback: string): ProcessActivity | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const parts = messages[messageIndex].parts;
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part.type !== "toolCall" || part.toolName !== "TodoWrite") continue;
      const todos = readTodos(part.args.todos);
      if (todos === undefined) continue;
      const current = todos.find((todo) => todo.status === "in_progress")?.content ?? fallback;
      return {
        todos,
        completed: todos.filter((todo) => todo.status === "completed").length,
        total: todos.length,
        current,
        pending: todos.filter((todo) => todo.status === "pending").length,
      };
    }
  }
  return undefined;
}

function readTodos(value: unknown): TodoView[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return [];
  const todos: TodoView[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const todo = entry as TodoInput;
    if (typeof todo.content !== "string" || todo.content.trim().length === 0) return undefined;
    if (todo.status !== "pending" && todo.status !== "in_progress" && todo.status !== "completed") return undefined;
    if (todo.priority !== "high" && todo.priority !== "medium" && todo.priority !== "low") return undefined;
    todos.push({ content: todo.content, status: todo.status });
  }
  return todos;
}

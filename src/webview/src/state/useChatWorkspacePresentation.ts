import { useMemo } from "react";
import type { ChatMessage } from "../../../shared/ipc";
import type { SubagentProjectionMap } from "./sessionActivityProjection";
import type { TaskChangeCardCommand } from "../components/MessageItem";
import {
  agentActivityFromWorkspace,
  processActivityFromMessages,
  type AgentActivityProjection,
} from "../components/context-capsule/activityProjection";
import { summarizeChanges } from "../components/task/taskViewModel";
import type { TerminalActivitySummary } from "../components/terminal/useTerminalActivityProjection";
import type { WorkbenchTask } from "./workbenchState";

export function useChatWorkspacePresentation(input: {
  messages: readonly ChatMessage[];
  streaming: boolean;
  task: WorkbenchTask | null;
  sessionId?: string | null;
  activeRouteId: string;
  hunks: Parameters<typeof summarizeChanges>[0];
  changedFiles: readonly string[];
  terminal: TerminalActivitySummary;
  agentName: string;
  sessionStatus?: AgentActivityProjection["agent"]["status"];
  subagents?: SubagentProjectionMap;
  onOpenSubagent?: (childId: string) => void;
  onCompare: () => void;
  onOpenProcess: () => void;
  onOpenTerminal: () => void;
  /** 工作区级 git 兜底（无任务时让胶囊 Git 段仍可见）。 */
  workspaceBranch?: string | null;
  workspaceKindFallback?: string;
}): {
  activity: AgentActivityProjection;
  taskChanges: Record<string, TaskChangeCardCommand> | undefined;
} {
  const process = useMemo(
    () => processActivityFromMessages(input.messages, "等待下一步"),
    [input.messages],
  );
  const changeSummary = useMemo(() => summarizeChanges(input.hunks), [input.hunks]);
  const taskChangeSummary = useMemo(
    () => ({ ...changeSummary, fileCount: Math.max(changeSummary.fileCount, input.changedFiles.length) }),
    [changeSummary, input.changedFiles],
  );

  const taskChanges = useMemo<Record<string, TaskChangeCardCommand> | undefined>(() => {
    let lastAssistant: ChatMessage | undefined;
    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
      if (input.messages[index].role === "assistant") {
        lastAssistant = input.messages[index];
        break;
      }
    }
    if (!input.task || !lastAssistant || input.changedFiles.length === 0) return undefined;
    const checkpointId = input.task.routes.find((route) => route.routeId === input.activeRouteId)?.checkpointId ?? "";
    return {
      [lastAssistant.id]: { summary: taskChangeSummary, checkpointId, validation: null },
    };
  }, [input.messages, input.task, input.activeRouteId, input.changedFiles, taskChangeSummary]);

  const activity = useMemo(
    () => agentActivityFromWorkspace({
      task: input.task,
      workspaceBranch: input.workspaceBranch ?? null,
      workspaceKindFallback: input.workspaceKindFallback,
      changedFiles: input.changedFiles,
      changeSummary,
      process,
      terminal: input.terminal,
      agentName: input.agentName,
      streaming: input.streaming,
      sessionStatus: input.sessionStatus,
      onCompare: input.onCompare,
      onOpenProcess: input.task ? input.onOpenProcess : undefined,
      onOpenTerminal: input.task ? input.onOpenTerminal : undefined,
      subagents: input.subagents
        ? [...input.subagents.values()].filter((child) => child.parentSessionId === input.sessionId)
        : undefined,
      onOpenSubagent: input.onOpenSubagent,
    }),
    [input.task, input.workspaceBranch, input.workspaceKindFallback, input.sessionId, input.subagents, input.changedFiles, input.terminal, input.agentName, input.streaming, input.sessionStatus, input.onCompare, input.onOpenProcess, input.onOpenTerminal, input.onOpenSubagent, changeSummary, process],
  );

  return { activity, taskChanges };
}

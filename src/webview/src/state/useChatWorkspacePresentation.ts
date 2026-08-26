import { useMemo } from "react";
import type { ChatMessage } from "../../../shared/ipc";
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
  activeRouteId: string;
  hunks: Parameters<typeof summarizeChanges>[0];
  changedFiles: readonly string[];
  terminal: TerminalActivitySummary;
  agentName: string;
  sessionStatus?: AgentActivityProjection["agent"]["status"];
  onCompare: () => void;
  onOpenProcess: () => void;
  onOpenTerminal: () => void;
}): {
  activity: AgentActivityProjection;
  taskChanges: Record<string, TaskChangeCardCommand> | undefined;
} {
  const process = useMemo(
    () => processActivityFromMessages(input.messages, input.streaming ? "正在生成回复" : "等待下一步"),
    [input.messages, input.streaming],
  );
  const changeSummary = useMemo(() => summarizeChanges(input.hunks), [input.hunks]);

  const taskChanges = useMemo<Record<string, TaskChangeCardCommand> | undefined>(() => {
    let lastAssistant: ChatMessage | undefined;
    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
      if (input.messages[index].role === "assistant") {
        lastAssistant = input.messages[index];
        break;
      }
    }
    if (!input.task || !lastAssistant || changeSummary.fileCount === 0) return undefined;
    const checkpointId = input.task.routes.find((route) => route.routeId === input.activeRouteId)?.checkpointId ?? "";
    return {
      [lastAssistant.id]: { summary: changeSummary, checkpointId, validation: null },
    };
  }, [input.messages, input.task, input.activeRouteId, changeSummary]);

  const activity = useMemo(
    () => agentActivityFromWorkspace({
      task: input.task,
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
    }),
    [input.task, input.changedFiles, input.terminal, input.agentName, input.streaming, input.sessionStatus, input.onCompare, input.onOpenProcess, input.onOpenTerminal, changeSummary, process],
  );

  return { activity, taskChanges };
}

import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { ReviewPanel } from "../components/task/ReviewPanel";
import { RoutePanel } from "../components/task/RoutePanel";
import { CodePanel } from "../components/code/CodePanel";
import { TerminalPanel, type TerminalActivitySummary } from "../components/terminal/TerminalPanel";
import { RecoveryBanner } from "../components/RecoveryBanner";
import { WorkbenchHome } from "../components/workbench/WorkbenchHome";
import { SubagentPanel, type SubagentPanelChild } from "../components/workbench/SubagentPanel";
import { codeApi, terminalApi } from "../lib/ipc";
import { groupHunksByFile } from "../components/task/taskViewModel";
import type { WorkbenchStateController } from "./useWorkbenchState";
import type { TaskReviewDataController } from "./useTaskReviewData";
import type { WorkbenchTabId } from "../components/workbench/WorkbenchTabs";
import { restartWarningVisible } from "./workbenchState";

export function useWorkbenchPresentation({
  t,
  workbench,
  reviewData,
  codeFontSize,
  onTerminalActivityChange,
  onSelectTab,
  showError,
  selectedFilePath,
  onSelectFile,
  onCloseTerminal,
  selectedSubagent,
}: {
  t: (key: string) => string;
  workbench: WorkbenchStateController;
  reviewData: TaskReviewDataController;
  /** xterm 前端字号（设置里的代码字号，px）——透传 TerminalPanel。 */
  codeFontSize: number;
  onTerminalActivityChange?: (activity: TerminalActivitySummary) => void;
  onSelectTab: (tab: WorkbenchTabId) => void;
  showError: (message: string) => void;
  selectedFilePath?: string;
  onSelectFile?: (path: string) => void;
  onCloseTerminal: () => void;
  selectedSubagent?: SubagentPanelChild | null;
}): { workbenchPanels: Record<string, ReactNode>; banner: ReactNode } {
  const task = workbench.state.task;
  const reviewFiles = useMemo(() => groupHunksByFile(reviewData.hunks), [reviewData.hunks]);
  const reviewAndRefresh = useCallback(
    async (dto: Parameters<typeof workbench.review>[0]) => {
      try {
        await workbench.review(dto);
        await reviewData.refresh();
      } catch (cause) {
        console.error("workbench review failed", cause);
        showError(t("error.review"));
      }
    },
    [workbench.review, reviewData, showError, t],
  );
  const restoreAndRefresh = useCallback(
    async (request: Parameters<typeof workbench.restore>[0]) => {
      try {
        await workbench.restore(request);
        await reviewData.refresh();
      } catch (cause) {
        console.error("workbench restore failed", cause);
        showError(t("error.restore"));
      }
    },
    [workbench.restore, reviewData, showError, t],
  );
  const workbenchPanels = useMemo<Record<string, ReactNode>>(
    () => ({
      home: <WorkbenchHome onSelect={onSelectTab} t={t} />,
      assistant: <SubagentPanel child={selectedSubagent ?? null} />,
      review: (
        <ReviewPanel
          files={reviewFiles}
          taskId={task?.taskId ?? ""}
          routeId={workbench.state.activeRouteId}
          expectedVersion={task?.expectedVersion ?? ""}
          t={t}
          onReview={(dto) => void reviewAndRefresh(dto)}
          onRestore={(request) => void restoreAndRefresh(request)}
        />
      ),
      routes: (
        <RoutePanel
          taskId={task?.taskId ?? ""}
          routes={task?.routes ?? []}
          activeRouteId={workbench.state.activeRouteId}
          t={t}
          switchRoute={workbench.switchRoute}
        />
      ),
      code: (
        <CodePanel
          taskId={task?.taskId ?? ""}
          routeId={workbench.state.activeRouteId}
          files={reviewData.files}
          activePath={selectedFilePath}
          onSelectFile={onSelectFile}
          t={t}
          api={codeApi}
        />
      ),
      todo: <div className="grid flex-1 place-items-center px-4 py-8 text-(--color-app-muted)">{t("workbench.placeholder.todo")}</div>,
      terminal: <TerminalPanel api={terminalApi} codeFontSize={codeFontSize} activeTask={workbench.activeTask} onActivityChange={onTerminalActivityChange} onClose={onCloseTerminal} />,
      browser: <div className="grid flex-1 place-items-center px-4 py-8 text-(--color-app-muted)">{t("workbench.placeholder.browser")}</div>,
    }),
    [t, task, selectedSubagent, workbench.state.activeRouteId, reviewFiles, reviewData.files, reviewAndRefresh, restoreAndRefresh, workbench.switchRoute, workbench.activeTask, codeFontSize, onTerminalActivityChange, onSelectTab, selectedFilePath, onSelectFile, onCloseTerminal],
  );
  const banner = useMemo(() => {
    const recovery = workbench.state.recovery;
    if (!restartWarningVisible(workbench.state)) return null;
    const message = recovery.eventRecoveryFailed !== null
      ? t("workbench.warning.eventRecovery")
      : recovery.worktreeFailure !== null
        ? t("workbench.warning.worktree")
        : recovery.checkpointFailed !== null
          ? t("workbench.warning.checkpoint")
          : recovery.recoveredFromInconsistent !== null
            ? t("workbench.warning.inconsistent")
            : t("workbench.warning.restart");
    const retryTaskId = recovery.worktreeFailure?.retry.taskId;
    return (
      <RecoveryBanner
        message={message}
        onRetry={retryTaskId !== undefined ? () => void workbench.retryRecovery(retryTaskId) : undefined}
        onDismiss={workbench.dismissRestartWarning}
        retryLabel={t("workbench.warning.retry")}
        dismissLabel={t("workbench.warning.dismiss")}
      />
    );
  }, [workbench.state, workbench.retryRecovery, workbench.dismissRestartWarning, t]);

  return { workbenchPanels, banner };
}

import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { ReviewPanel } from "../components/task/ReviewPanel";
import { RoutePanel } from "../components/task/RoutePanel";
import { CodePanel } from "../components/code/CodePanel";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { RecoveryBanner } from "../components/RecoveryBanner";
import { codeApi, terminalApi } from "../lib/ipc";
import { groupHunksByFile } from "../components/task/taskViewModel";
import type { WorkbenchStateController } from "./useWorkbenchState";
import type { TaskReviewDataController } from "./useTaskReviewData";
import { restartWarningVisible } from "./workbenchState";

export function useWorkbenchPresentation({
  t,
  workbench,
  reviewData,
}: {
  t: (key: string) => string;
  workbench: WorkbenchStateController;
  reviewData: TaskReviewDataController;
}): { workbenchPanels: Record<string, ReactNode>; banner: ReactNode } {
  const task = workbench.state.task;
  const reviewFiles = useMemo(() => groupHunksByFile(reviewData.hunks), [reviewData.hunks]);
  const reviewAndRefresh = useCallback(
    async (dto: Parameters<typeof workbench.review>[0]) => {
      await workbench.review(dto);
      await reviewData.refresh();
    },
    [workbench.review, reviewData],
  );
  const restoreAndRefresh = useCallback(
    async (request: Parameters<typeof workbench.restore>[0]) => {
      await workbench.restore(request);
      await reviewData.refresh();
    },
    [workbench.restore, reviewData],
  );
  const workbenchPanels = useMemo<Record<string, ReactNode>>(
    () => ({
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
          t={t}
          api={codeApi}
        />
      ),
      terminal: <TerminalPanel api={terminalApi} activeTask={workbench.activeTask} />,
    }),
    [t, task, workbench.state.activeRouteId, reviewFiles, reviewData.files, reviewAndRefresh, restoreAndRefresh, workbench.switchRoute, workbench.activeTask],
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

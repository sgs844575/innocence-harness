// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchPresentation } from "./useWorkbenchPresentation";

const review = vi.hoisted(() => vi.fn());
const restore = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("../components/task/ReviewPanel", () => ({
  ReviewPanel: ({ onReview, onRestore }: { onReview?: (value: unknown) => void; onRestore?: (value: unknown) => void }) => (
    <>
      <button type="button" onClick={() => onReview?.({ id: "review" })}>review</button>
      <button type="button" onClick={() => onRestore?.({ id: "restore" })}>restore</button>
    </>
  ),
}));
vi.mock("../components/task/RoutePanel", () => ({ RoutePanel: () => <div>routes</div> }));
vi.mock("../components/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ onClose }: { onClose?: () => void }) => <button type="button" onClick={onClose}>terminal</button>,
}));
vi.mock("../components/workbench/WorkbenchHome", () => ({ WorkbenchHome: () => <div>home</div> }));
vi.mock("../lib/ipc", () => ({ codeApi: {}, terminalApi: {} }));

const workbench = {
  state: {
    task: { taskId: "task", sessionId: "session", expectedVersion: "v1", routes: [], status: "running", mode: "default", workspaceKind: "git", gitBranch: null },
    activeRouteId: "main",
    recovery: { eventRecoveryFailed: null, worktreeFailure: null, checkpointFailed: null, recoveredFromInconsistent: null },
  },
  activeTask: { taskId: "task", routeId: "main" },
  review,
  restore,
  switchRoute: vi.fn(),
  retryRecovery: vi.fn(),
  dismissRestartWarning: vi.fn(),
};

function Harness({ showError, onCloseTerminal = () => undefined }: { showError: (message: string) => void; onCloseTerminal?: () => void }): React.JSX.Element {
  const presentation = useWorkbenchPresentation({
    t: (key) => key,
    workbench: workbench as never,
    reviewData: { hunks: [], refresh, files: [] } as never,
    showError,
    onCloseTerminal,
    onSelectTab: () => undefined,
  });
  return <>{presentation.workbenchPanels.review}{presentation.workbenchPanels.terminal}{presentation.workbenchPanels.todo}{presentation.workbenchPanels.browser}</>;
}

afterEach(() => {
  cleanup();
  review.mockReset();
  restore.mockReset();
  refresh.mockReset();
});

describe("useWorkbenchPresentation review errors", () => {
  it("reports review rejection through showError without losing the request", async () => {
    review.mockRejectedValueOnce(new Error("review failed"));
    const showError = vi.fn();
    render(<Harness showError={showError} />);
    fireEvent.click(screen.getByRole("button", { name: "review" }));
    await waitFor(() => expect(showError).toHaveBeenCalledWith("error.review"));
    expect(review).toHaveBeenCalledWith({ id: "review" });
  });

  it("reports restore rejection through showError without losing the request", async () => {
    restore.mockRejectedValueOnce(new Error("restore failed"));
    const showError = vi.fn();
    render(<Harness showError={showError} />);
    fireEvent.click(screen.getByRole("button", { name: "restore" }));
    await waitFor(() => expect(showError).toHaveBeenCalledWith("error.restore"));
    expect(restore).toHaveBeenCalledWith({ id: "restore" });
  });

  it("passes the workbench close command to the terminal panel", () => {
    const onCloseTerminal = vi.fn();
    render(<Harness showError={vi.fn()} onCloseTerminal={onCloseTerminal} />);
    fireEvent.click(screen.getByRole("button", { name: "terminal" }));
    expect(onCloseTerminal).toHaveBeenCalledTimes(1);
  });

  it("renders todo and browser placeholders through i18n keys instead of hardcoded copy", () => {
    render(<Harness showError={vi.fn()} />);
    expect(screen.getByText("workbench.placeholder.todo")).toBeTruthy();
    expect(screen.getByText("workbench.placeholder.browser")).toBeTruthy();
  });
});

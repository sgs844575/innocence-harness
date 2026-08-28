// @vitest-environment jsdom
// C3 (final review): task:changes feeds the review surface. The hook pulls
// the view model (statused hunks + changed paths) and the file tree
// (code:list-files); ReviewPanel renders straight from the DTO through
// groupHunksByFile — the shape the main-side handler produces.
import { act, render, renderHook, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskChangesResponse } from "../../../shared/taskIpc";
import { ReviewPanel } from "../components/task/ReviewPanel";
import { groupHunksByFile } from "../components/task/taskViewModel";

const apisMock = vi.hoisted(() => ({
  task: { changes: vi.fn<(request: unknown) => Promise<TaskChangesResponse>>() },
  code: { listFiles: vi.fn<(request: unknown) => Promise<{ files: string[] }>>() },
}));

vi.mock("../lib/ipc", () => ({ taskApi: apisMock.task, codeApi: apisMock.code }));

import { loadTaskReviewData, useTaskReviewData } from "./useTaskReviewData";

const changesResponse: TaskChangesResponse = {
  hunks: [
    { ref: "t1:0", path: "src/a.ts", before: "a\n", after: "b\n", context: [], status: "pending" },
    { ref: "t1:1", path: "src/a.ts", before: "c\n", after: "d\n", context: [], status: "accepted" },
  ],
  changedFiles: ["src/a.ts", "logo.png"],
};

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("loadTaskReviewData (pure loader)", () => {
  it("combines task:changes with code:list-files", async () => {
    apisMock.task.changes.mockResolvedValue(changesResponse);
    apisMock.code.listFiles.mockResolvedValue({ files: ["src/a.ts", "logo.png"] });
    const data = await loadTaskReviewData(
      { task: apisMock.task, code: apisMock.code },
      { taskId: "t1", routeId: "main" },
    );
    expect(apisMock.task.changes).toHaveBeenCalledWith({ taskId: "t1", routeId: "main" });
    expect(data.hunks).toHaveLength(2);
    expect(data.changedFiles).toEqual(["src/a.ts", "logo.png"]);
    expect(data.files).toEqual(["src/a.ts", "logo.png"]);
  });

  it("tolerates a listing failure (empty tree, hunks still load)", async () => {
    apisMock.task.changes.mockResolvedValue(changesResponse);
    apisMock.code.listFiles.mockRejectedValue(new Error("unknown task/route"));
    const data = await loadTaskReviewData(
      { task: apisMock.task, code: apisMock.code },
      { taskId: "t1", routeId: "main" },
    );
    expect(data.files).toEqual([]);
    expect(data.hunks).toHaveLength(2);
  });
});

describe("useTaskReviewData (hook)", () => {
  it("loads on task/route change and refresh() re-pulls", async () => {
    apisMock.task.changes.mockResolvedValue(changesResponse);
    apisMock.code.listFiles.mockResolvedValue({ files: ["src/a.ts"] });

    const { result } = renderHook(() => useTaskReviewData({ taskId: "t1", routeId: "main" }));
    expect(result.current.hunks).toEqual([]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.hunks).toHaveLength(2);

    apisMock.task.changes.mockResolvedValue({ hunks: [], changedFiles: [] });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.hunks).toHaveLength(0);
  });

  it("does not let a stale task/route load overwrite the newly selected review", async () => {
    let resolveOldChanges: ((value: TaskChangesResponse) => void) | undefined;
    let resolveOldFiles: ((value: { files: string[] }) => void) | undefined;
    const oldChanges = new Promise<TaskChangesResponse>((resolve) => { resolveOldChanges = resolve; });
    const oldFiles = new Promise<{ files: string[] }>((resolve) => { resolveOldFiles = resolve; });
    const nextChanges: TaskChangesResponse = { hunks: [], changedFiles: ["new.ts"] };
    apisMock.task.changes.mockImplementation((request: unknown) =>
      (request as { taskId: string }).taskId === "old" ? oldChanges : Promise.resolve(nextChanges));
    apisMock.code.listFiles.mockImplementation((request: unknown) =>
      (request as { taskId: string }).taskId === "old" ? oldFiles : Promise.resolve({ files: ["new.ts"] }));

    const { result, rerender } = renderHook(({ taskId }) => useTaskReviewData({ taskId, routeId: "main" }), {
      initialProps: { taskId: "old" },
    });
    rerender({ taskId: "new" });
    await waitFor(() => expect(result.current.changedFiles).toEqual(["new.ts"]));

    resolveOldChanges?.(changesResponse);
    resolveOldFiles?.({ files: ["old.ts"] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.changedFiles).toEqual(["new.ts"]);
    expect(result.current.files).toEqual(["new.ts"]);
  });

  it("does not let an older refresh overwrite a newer task/route request", async () => {
    const nextChanges: TaskChangesResponse = { hunks: [], changedFiles: ["new.ts"] };
    apisMock.task.changes.mockResolvedValue(changesResponse);
    apisMock.code.listFiles.mockResolvedValue({ files: ["old.ts"] });
    const { result, rerender } = renderHook(({ taskId }) => useTaskReviewData({ taskId, routeId: "main" }), {
      initialProps: { taskId: "old" },
    });
    await waitFor(() => expect(result.current.changedFiles).toEqual(["src/a.ts", "logo.png"]));

    let resolveRefresh: ((value: TaskChangesResponse) => void) | undefined;
    const staleRefresh = new Promise<TaskChangesResponse>((resolve) => { resolveRefresh = resolve; });
    apisMock.task.changes.mockImplementation((request: unknown) =>
      (request as { taskId: string }).taskId === "old" ? staleRefresh : Promise.resolve(nextChanges));
    apisMock.code.listFiles.mockResolvedValue({ files: ["new.ts"] });
    let oldRefresh: Promise<void> | undefined;
    act(() => { oldRefresh = result.current.refresh(); });

    rerender({ taskId: "new" });
    await waitFor(() => expect(result.current.changedFiles).toEqual(["new.ts"]));
    resolveRefresh?.(changesResponse);
    await act(async () => { await oldRefresh; });
    expect(result.current.changedFiles).toEqual(["new.ts"]);
  });

  it("feeds ReviewPanel: the handler DTO renders through groupHunksByFile", async () => {
    const groups = groupHunksByFile(changesResponse.hunks);
    render(
      <ReviewPanel
        files={groups}
        taskId="t1"
        routeId="main"
        expectedVersion="evt_1"
        onReview={() => {}}
        onRestore={() => {}}
      />,
    );
    expect(document.querySelector("section[aria-label='变更审查']") !== null).toBe(true);
    expect(document.body.textContent).toContain("src/a.ts");
  });
});

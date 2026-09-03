// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewView } from "./ReviewView";
import type { ReviewFileDiffResult, ReviewScope } from "../../../shared/ipc";

afterEach(cleanup);

const t = (key: string) => key;

const FILES = {
  files: [
    { path: "src/main/ipc.ts", additions: 7, deletions: 1 },
    { path: "新建.md", additions: 3, deletions: 0, untracked: true },
  ],
};

const PATCH = [
  "diff --git a/src/main/ipc.ts b/src/main/ipc.ts",
  "--- a/src/main/ipc.ts",
  "+++ b/src/main/ipc.ts",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+new",
  "",
].join("\n");

function stubLoaders(diff: ReviewFileDiffResult = { kind: "patch", patch: PATCH }) {
  return {
    loadFiles: vi.fn(async (_root: string, _scope: ReviewScope): Promise<{ files: typeof FILES.files } | null> => FILES),
    loadDiff: vi.fn(async () => diff),
  };
}

describe("ReviewView", () => {
  it("非仓库/无项目根：空态文案", async () => {
    const loaders = stubLoaders();
    loaders.loadFiles.mockResolvedValue(null);
    render(<ReviewView t={t} workspaceRoot="D:/x" {...loaders} />);
    await waitFor(() => expect(screen.getByText("dock.review.notRepo")).toBeTruthy());
    expect(screen.getByText("dock.review.notRepoHint")).toBeTruthy();
  });

  it("文件列表：名称 + 目录 + ±行数；作用域默认未暂存", async () => {
    const loaders = stubLoaders();
    render(<ReviewView t={t} workspaceRoot="D:/x" {...loaders} />);
    await waitFor(() => expect(screen.getByText("ipc.ts")).toBeTruthy());
    expect(loaders.loadFiles).toHaveBeenCalledWith("D:/x", "unstaged");
    expect(screen.getByText("src/main/")).toBeTruthy();
    expect(screen.getByText("+7")).toBeTruthy();
    expect(screen.getByText("−1")).toBeTruthy();
    expect(screen.getByText("新建.md")).toBeTruthy();
    expect(screen.getByText("dock.review.scope.unstaged")).toBeTruthy();
  });

  it("展开文件行内 diff：双列行号 + 增删行", async () => {
    const loaders = stubLoaders();
    const { container } = render(<ReviewView t={t} workspaceRoot="D:/x" {...loaders} />);
    await waitFor(() => expect(screen.getByText("ipc.ts")).toBeTruthy());
    fireEvent.click(screen.getByText("ipc.ts"));
    await waitFor(() => expect(screen.getByText("old")).toBeTruthy());
    expect(loaders.loadDiff).toHaveBeenCalledWith("D:/x", "unstaged", "src/main/ipc.ts");
    expect(container.querySelector(".diff-line-del")?.textContent).toContain("old");
    expect(container.querySelector(".diff-line-add")?.textContent).toContain("new");
  });

  it("未跟踪文件展开：全文按全新增行渲染", async () => {
    const loaders = stubLoaders({ kind: "untracked", text: "一\n二\n三\n" });
    const { container } = render(<ReviewView t={t} workspaceRoot="D:/x" {...loaders} />);
    await waitFor(() => expect(screen.getByText("新建.md")).toBeTruthy());
    fireEvent.click(screen.getByText("新建.md"));
    await waitFor(() => expect(container.querySelectorAll(".diff-line-add").length).toBe(3));
  });

  it("切换作用域重载并清空展开态", async () => {
    const loaders = stubLoaders();
    render(<ReviewView t={t} workspaceRoot="D:/x" {...loaders} />);
    await waitFor(() => expect(screen.getByText("ipc.ts")).toBeTruthy());
    fireEvent.click(screen.getByText("dock.review.scope.unstaged"));
    fireEvent.click(screen.getByText("dock.review.scope.staged"));
    await waitFor(() => expect(loaders.loadFiles).toHaveBeenCalledWith("D:/x", "staged"));
  });

  it("无改动：空列表文案", async () => {
    const loaders = stubLoaders();
    loaders.loadFiles.mockResolvedValue({ files: [] });
    render(<ReviewView t={t} workspaceRoot="D:/x" {...loaders} />);
    await waitFor(() => expect(screen.getByText("dock.review.empty")).toBeTruthy());
  });
});

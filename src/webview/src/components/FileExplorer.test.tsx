// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileExplorer } from "./FileExplorer";

const t = (key: string) => key;

const bridge = {
  listWorkspaceDir: vi.fn(async (_root: string, rel: string) =>
    rel === ""
      ? [
          { name: "src", rel: "src", isDir: true },
          { name: "a.ts", rel: "a.ts", isDir: false },
        ]
      : rel === "src"
        ? [{ name: "b.ts", rel: "src/b.ts", isDir: false }]
        : [],
  ),
  workspaceGitReviewFiles: vi.fn(async () => ({ files: [{ path: "a.ts", additions: 1, deletions: 0 }] })),
  listWorkspaceFiles: vi.fn(async () => ["a.ts", "src/b.ts"]),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as Record<string, unknown>).innocencecode = bridge;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).innocencecode;
  cleanup();
});

function renderExplorer(onOpenFile = vi.fn()) {
  const onBack = vi.fn();
  render(<FileExplorer t={t} root="D:/proj" onBack={onBack} onOpenFile={onOpenFile} />);
  return { onBack, onOpenFile };
}

describe("FileExplorer", () => {
  it("装载根目录（目录在前）并拉取 Git 变更集", async () => {
    renderExplorer();
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(bridge.workspaceGitReviewFiles).toHaveBeenCalledWith("D:/proj", "unstaged");
  });

  it("展开目录时懒加载其子项", async () => {
    renderExplorer();
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    fireEvent.click(screen.getByText("src"));
    await waitFor(() => expect(screen.getByText("b.ts")).toBeTruthy());
    expect(bridge.listWorkspaceDir).toHaveBeenCalledWith("D:/proj", "src");
  });

  it("点文件回传相对路径；返回任务回退", async () => {
    const { onBack, onOpenFile } = renderExplorer();
    await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy());
    fireEvent.click(screen.getByText("a.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("a.ts");
    fireEvent.click(screen.getByRole("button", { name: /sidebar.files.back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("搜索切换为全量路径过滤列表", async () => {
    renderExplorer();
    await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("sidebar.files.search"), { target: { value: "b.ts" } });
    await waitFor(() => expect(screen.getByText("src/b.ts")).toBeTruthy());
    expect(bridge.listWorkspaceFiles).toHaveBeenCalledWith("D:/proj");
    expect(screen.queryByText("a.ts")).toBeNull();
  });
});

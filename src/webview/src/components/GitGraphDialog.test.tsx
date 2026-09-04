// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitGraphData } from "../../../shared/ipc";
import { GitGraphDialog } from "./GitGraphDialog";

afterEach(cleanup);

const t = (key: string) => key;

function mockBridge(data: GitGraphData | null) {
  const bridge = { workspaceGitGraph: vi.fn(async () => data) };
  (window as unknown as { innocencecode: unknown }).innocencecode = bridge;
  return bridge;
}

const graph: GitGraphData = {
  head: "main",
  commits: [
    {
      hash: "aaa1111bbb",
      parents: ["ccc2222ddd"],
      author: "Alice",
      at: 1700000000,
      subject: "feat: second",
      refs: [{ name: "main", kind: "branch" }],
    },
    {
      hash: "ccc2222ddd",
      parents: [],
      author: "Bob",
      at: 1699990000,
      subject: "chore: init",
      refs: [{ name: "v1.0", kind: "tag" }],
    },
  ],
  truncated: false,
};

describe("GitGraphDialog", () => {
  it("加载后渲染提交主题、作者、短哈希与引用徽标（HEAD 标记在当前分支）", async () => {
    const bridge = mockBridge(graph);
    render(<GitGraphDialog t={t} root="D:/x" onClose={() => {}} />);
    expect(screen.getByText("graph.loading")).toBeTruthy();
    await waitFor(() => screen.getByText("feat: second"));
    expect(bridge.workspaceGitGraph).toHaveBeenCalledWith("D:/x");
    expect(screen.getByText("chore: init")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("aaa1111")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("HEAD→")).toBeTruthy();
    expect(screen.getByText("v1.0")).toBeTruthy();
  });

  it("非仓库/失败：显示失败态", async () => {
    mockBridge(null);
    render(<GitGraphDialog t={t} root="D:/x" onClose={() => {}} />);
    await waitFor(() => screen.getByText("graph.failed"));
  });

  it("空仓：显示空态", async () => {
    mockBridge({ head: null, commits: [], truncated: false });
    render(<GitGraphDialog t={t} root="D:/x" onClose={() => {}} />);
    await waitFor(() => screen.getByText("graph.empty"));
  });

  it("截断时显示截断提示", async () => {
    mockBridge({ ...graph, truncated: true });
    render(<GitGraphDialog t={t} root="D:/x" onClose={() => {}} />);
    await waitFor(() => screen.getByText("graph.truncated"));
  });

  it("Esc 与遮罩点击关闭", async () => {
    mockBridge(graph);
    const onClose = vi.fn();
    render(<GitGraphDialog t={t} root="D:/x" onClose={onClose} />);
    await waitFor(() => screen.getByText("feat: second"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

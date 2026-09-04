// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BranchPicker } from "./BranchPicker";

afterEach(cleanup);

const t = (key: string) => key;

function mockBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    workspaceGitBranches: vi.fn(async () => ({ current: "main", branches: ["main", "dev", "feature/login"] })),
    workspaceGitChanges: vi.fn(async () => ({ changedFiles: 3, additions: 10, deletions: 2 })),
    workspaceGitCheckout: vi.fn(async (_root: string, branch: string) => ({ ok: true, branch })),
    ...overrides,
  };
  (window as unknown as { innocencecode: unknown }).innocencecode = bridge;
  return bridge;
}

function renderPicker(extra: Partial<Parameters<typeof BranchPicker>[0]> = {}) {
  return render(
    <BranchPicker t={t} root="D:/x" current="main" onSwitched={() => {}} onError={() => {}} {...extra} />,
  );
}

describe("BranchPicker", () => {
  it("当前分支为 null 时不渲染（对齐参考的隐藏规则）", () => {
    mockBridge();
    const { container } = renderPicker({ current: null });
    expect(container.firstChild).toBeNull();
  });

  it("打开后列出分支、当前分支带对勾与未提交统计", async () => {
    mockBridge();
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /main/ }));
    await waitFor(() => screen.getByText("dev"));
    expect(screen.getByText("feature/login")).toBeTruthy();
    expect(screen.getByText(/branch.uncommitted/)).toBeTruthy();
  });

  it("搜索过滤分支列表", async () => {
    mockBridge();
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /main/ }));
    await waitFor(() => screen.getByText("dev"));
    fireEvent.change(screen.getByRole("textbox", { name: "branch.search" }), { target: { value: "dev" } });
    expect(screen.queryByText("feature/login")).toBeNull();
    expect(screen.getByText("dev")).toBeTruthy();
  });

  it("点击分支触发检出并回调切换", async () => {
    const bridge = mockBridge();
    const onSwitched = vi.fn();
    renderPicker({ onSwitched });
    fireEvent.click(screen.getByRole("button", { name: /main/ }));
    await waitFor(() => screen.getByText("dev"));
    fireEvent.click(screen.getByText("dev"));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith("dev"));
    expect(bridge.workspaceGitCheckout).toHaveBeenCalledWith("D:/x", "dev", false);
  });

  it("创建并检出新分支：输入名字回车走 create=true", async () => {
    const bridge = mockBridge();
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /main/ }));
    await waitFor(() => screen.getByText("dev"));
    fireEvent.click(screen.getByRole("button", { name: /branch.create/ }));
    const input = screen.getByRole("textbox", { name: "branch.createPlaceholder" });
    fireEvent.change(input, { target: { value: "feat/new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(bridge.workspaceGitCheckout).toHaveBeenCalledWith("D:/x", "feat/new", true));
  });

  it("检出失败走错误回调", async () => {
    mockBridge({ workspaceGitCheckout: vi.fn(async () => ({ ok: false, error: "conflict" })) });
    const onError = vi.fn();
    renderPicker({ onError });
    fireEvent.click(screen.getByRole("button", { name: /main/ }));
    await waitFor(() => screen.getByText("dev"));
    fireEvent.click(screen.getByText("dev"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("branch.switchFailed：conflict"));
  });

  it("「Git 图谱」入口：提供 onOpenGraph 时点击触发并关闭面板", async () => {
    mockBridge();
    const onOpenGraph = vi.fn();
    renderPicker({ onOpenGraph });
    fireEvent.click(screen.getByRole("button", { name: /main/ }));
    await waitFor(() => screen.getByText("dev"));
    fireEvent.click(screen.getByRole("button", { name: /branch.graph/ }));
    expect(onOpenGraph).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("dev")).toBeNull());
  });

  it("未提供 onOpenGraph 时「Git 图谱」保持禁用占位", async () => {
    mockBridge();
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /main/ }));
    await waitFor(() => screen.getByText("dev"));
    const entry = screen.getByRole("button", { name: /branch.graph/ });
    expect(entry).toHaveProperty("disabled", true);
  });
});

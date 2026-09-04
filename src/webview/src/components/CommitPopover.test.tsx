// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommitPopover } from "./CommitPopover";

afterEach(() => {
  cleanup();
  delete (window as unknown as { innocencecode?: unknown }).innocencecode;
});

const t = (key: string) => key;

function mockBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    workspaceGitCommit: vi.fn(async () => ({ ok: true, summary: "1 file changed" })),
    workspaceGitPush: vi.fn(async () => ({ ok: true })),
    workspaceGitCommitMessage: vi.fn(async () => ({ ok: true, message: "feat: add commit popover" })),
    workspaceGitBranches: vi.fn(async () => ({ current: "main", branches: ["main"] })),
    workspaceGitChanges: vi.fn(async () => ({ changedFiles: 0, additions: 0, deletions: 0 })),
    ...overrides,
  };
  (window as unknown as { innocencecode: unknown }).innocencecode = bridge;
  return bridge;
}

function renderPopover(extra: Partial<Parameters<typeof CommitPopover>[0]> = {}) {
  return render(
    <CommitPopover
      t={t}
      root="D:/x"
      branch="main"
      changes={{ changedFiles: 2, additions: 10, deletions: 3, stagedFiles: 1, unstagedFiles: 1 }}
      onSwitched={() => {}}
      onCommitted={() => {}}
      onError={() => {}}
      trigger={<button type="button">capsule.commitPush</button>}
      {...extra}
    />,
  );
}

async function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: "capsule.commitPush" }));
  await waitFor(() => screen.getByRole("textbox", { name: "commit.messagePlaceholder" }));
}

describe("CommitPopover", () => {
  it("渲染三行动作、未暂存勾选与增删统计", async () => {
    mockBridge();
    renderPopover();
    await openPopover();
    expect(screen.getByRole("button", { name: /^commit.commit(?!Push)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "commit.commitPush" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "commit.push" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "commit.includeUnstaged" })).toBeTruthy();
    expect(screen.getByText("+10")).toBeTruthy();
    expect(screen.getByText("−3")).toBeTruthy();
  });

  it("以带遮罩的居中模态框展示", async () => {
    mockBridge();
    renderPopover();
    await openPopover();
    expect(screen.getByRole("dialog", { name: "capsule.commitPush" })).toBeTruthy();
    expect(screen.getByTestId("commit-dialog-overlay").className).toContain("fixed inset-0");
    expect(screen.getByRole("dialog", { name: "capsule.commitPush" }).className).toContain("top-1/2");
  });

  it("无更改时提交/提交并推送禁用", async () => {
    mockBridge();
    renderPopover({ changes: { changedFiles: 0, additions: 0, deletions: 0, stagedFiles: 0, unstagedFiles: 0 } });
    await openPopover();
    expect(screen.getByRole("button", { name: /^commit.commit(?!Push)/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "commit.commitPush" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "commit.push" })).toHaveProperty("disabled", false);
  });

  it("提交：带信息与 stageAll 调 IPC，成功后回调并关闭", async () => {
    const bridge = mockBridge();
    const onCommitted = vi.fn();
    renderPopover({ onCommitted });
    await openPopover();
    fireEvent.change(screen.getByRole("textbox", { name: "commit.messagePlaceholder" }), {
      target: { value: "my message" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^commit.commit(?!Push)/ }));
    await waitFor(() => expect(bridge.workspaceGitCommit).toHaveBeenCalledWith("D:/x", "my message", true));
    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "commit.messagePlaceholder" })).toBeNull());
  });

  it("提交失败：错误回调且面板保持打开", async () => {
    mockBridge({ workspaceGitCommit: vi.fn(async () => ({ ok: false, error: "boom" })) });
    const onError = vi.fn();
    renderPopover({ onError });
    await openPopover();
    fireEvent.click(screen.getByRole("button", { name: /^commit.commit(?!Push)/ }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("commit.failed：boom"));
    expect(screen.getByRole("textbox", { name: "commit.messagePlaceholder" })).toBeTruthy();
  });

  it("提交并推送：提交成功后推送；推送失败仍收尾关闭", async () => {
    const bridge = mockBridge({ workspaceGitPush: vi.fn(async () => ({ ok: false, error: "rejected" })) });
    const onCommitted = vi.fn();
    const onError = vi.fn();
    renderPopover({ onCommitted, onError });
    await openPopover();
    fireEvent.click(screen.getByRole("button", { name: "commit.commitPush" }));
    await waitFor(() => expect(bridge.workspaceGitCommit).toHaveBeenCalledWith("D:/x", "", true));
    await waitFor(() => expect(bridge.workspaceGitPush).toHaveBeenCalledWith("D:/x"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("commit.pushFailed：rejected"));
    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
  });

  it("推送：只调 workspaceGitPush，成功后回调并关闭", async () => {
    const bridge = mockBridge();
    const onCommitted = vi.fn();
    renderPopover({ onCommitted });
    await openPopover();
    fireEvent.click(screen.getByRole("button", { name: "commit.push" }));
    await waitFor(() => expect(bridge.workspaceGitPush).toHaveBeenCalledWith("D:/x"));
    expect(bridge.workspaceGitCommit).not.toHaveBeenCalled();
    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
  });

  it("生成：填充文本框；失败走错误回调", async () => {
    const bridge = mockBridge();
    renderPopover();
    await openPopover();
    fireEvent.click(screen.getByRole("button", { name: "commit.generate" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "commit.messagePlaceholder" })).toHaveProperty(
        "value",
        "feat: add commit popover",
      ),
    );
    expect(bridge.workspaceGitCommitMessage).toHaveBeenCalledWith("D:/x");
  });

  it("生成失败：错误回调带失败前缀", async () => {
    mockBridge({ workspaceGitCommitMessage: vi.fn(async () => ({ ok: false, error: "nothing to commit" })) });
    const onError = vi.fn();
    renderPopover({ onError });
    await openPopover();
    fireEvent.click(screen.getByRole("button", { name: "commit.generate" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("commit.generateFailed：nothing to commit"));
  });

  it("文本框内 Ctrl+Enter 触发提交", async () => {
    const bridge = mockBridge();
    const onCommitted = vi.fn();
    renderPopover({ onCommitted });
    await openPopover();
    const textarea = screen.getByRole("textbox", { name: "commit.messagePlaceholder" });
    fireEvent.change(textarea, { target: { value: "quick" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(bridge.workspaceGitCommit).toHaveBeenCalledWith("D:/x", "quick", true));
    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
  });

  it("勾选「包含未暂存的更改」后 stageAll 随之关闭", async () => {
    const bridge = mockBridge();
    renderPopover();
    await openPopover();
    fireEvent.click(screen.getByRole("checkbox", { name: "commit.includeUnstaged" }));
    fireEvent.click(screen.getByRole("button", { name: /^commit.commit(?!Push)/ }));
    await waitFor(() => expect(bridge.workspaceGitCommit).toHaveBeenCalledWith("D:/x", "", false));
  });
});

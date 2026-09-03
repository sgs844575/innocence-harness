// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitCapsule, type GitCapsuleData } from "./GitCapsule";

afterEach(cleanup);

const t = (key: string) => key;

function renderCapsule(data: Partial<GitCapsuleData> = {}) {
  const full: GitCapsuleData = {
    branch: "main",
    isGitRepo: true,
    changes: { changedFiles: 1, additions: 7, deletions: 3 },
    todos: [],
    ...data,
  };
  return render(<GitCapsule t={t} data={full} open onToggleOpen={() => {}} />);
}

describe("GitCapsule", () => {
  it("Git 仓库：标题「Git 工具」+ 更改/分支/提交或推送行", () => {
    renderCapsule();
    expect(screen.getByText("capsule.git")).toBeTruthy();
    expect(screen.getByText("+7")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("capsule.commitPush")).toBeTruthy();
  });

  it("非 Git 仓库：标题「活动」，无 Git 行，待办段仍在", () => {
    renderCapsule({
      isGitRepo: false,
      branch: null,
      changes: undefined,
      todos: [{ content: "任务一", status: "completed" }],
    });
    expect(screen.getByText("capsule.activity")).toBeTruthy();
    expect(screen.queryByText("capsule.commitPush")).toBeNull();
    expect(screen.getByText("任务一")).toBeTruthy();
  });

  it("智能体段：存活显示运行中，点击打开子代理面板", () => {
    const onOpenSubagents = vi.fn();
    renderCapsule({ subagents: { total: 2, running: 1 }, onOpenSubagents });
    const row = screen.getByRole("button", { name: /capsule.subagents.running/ });
    expect(row.textContent).toContain("2");
    fireEvent.click(row);
    expect(onOpenSubagents).toHaveBeenCalledTimes(1);
  });

  it("智能体段：全部结束后显示已结束", () => {
    renderCapsule({ subagents: { total: 2, running: 0 } });
    expect(screen.getByText("capsule.subagents.done")).toBeTruthy();
  });

  it("终端段：显示存活数，点击打开终端", () => {
    const onOpenTerminals = vi.fn();
    renderCapsule({ terminals: { count: 2 }, onOpenTerminals });
    const row = screen.getByRole("button", { name: /capsule.terminals.running/ });
    expect(row.textContent).toContain("2");
    fireEvent.click(row);
    expect(onOpenTerminals).toHaveBeenCalledTimes(1);
  });

  it("无智能体/终端时段不渲染", () => {
    renderCapsule();
    expect(screen.queryByText("capsule.subagents")).toBeNull();
    expect(screen.queryByText("capsule.terminals")).toBeNull();
  });
});

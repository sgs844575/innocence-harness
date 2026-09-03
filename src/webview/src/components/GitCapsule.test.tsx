// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitCapsule, type CapsuleSubagentItem, type GitCapsuleData } from "./GitCapsule";

afterEach(cleanup);

const t = (key: string) => key;

function item(childId: string, title: string, status: CapsuleSubagentItem["status"]): CapsuleSubagentItem {
  return { childId, title, status };
}

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

  it("智能体段：只直出进行中运行行（带暂停钮，点标题直达会话），终态不出现", () => {
    const onOpenSubagentRun = vi.fn();
    const onCancelSubagent = vi.fn();
    renderCapsule({
      subagents: {
        running: [item("c_live", "检索参考资料", "running")],
        completed: [item("c_done", "修复测试", "completed")],
      },
      onOpenSubagentRun,
      onCancelSubagent,
    });
    // 运行标题 → 打开该运行的会话记录
    fireEvent.click(screen.getByText("检索参考资料"));
    expect(onOpenSubagentRun).toHaveBeenCalledWith("c_live");
    // 暂停钮只取消，不打开
    fireEvent.click(screen.getByRole("button", { name: "capsule.subagents.pause" }));
    expect(onCancelSubagent).toHaveBeenCalledWith("c_live");
    // 终态行不直出胶囊（只经「查看全部」计数进入）
    expect(screen.queryByText("修复测试")).toBeNull();
    expect(onOpenSubagentRun).toHaveBeenCalledTimes(1);
  });

  it("智能体段：多路进行中运行全部直出（新→旧）", () => {
    renderCapsule({
      subagents: {
        running: [item("c_live", "存活任务", "running"), item("c_live2", "存活任务二", "started")],
        completed: [],
      },
    });
    const titles = [screen.getByText("存活任务"), screen.getByText("存活任务二")];
    expect(titles[0]!.compareDocumentPosition(titles[1]!) & 4).toBeTruthy();
  });

  it("智能体段：终态全部只经「查看全部」计数进入，不直出行", () => {
    renderCapsule({
      subagents: {
        running: [],
        completed: [
          item("c1", "任务一", "completed"),
          item("c2", "任务二", "failed"),
          item("c3", "任务三", "cancelled"),
        ],
      },
    });
    expect(screen.queryByText("任务一")).toBeNull();
    expect(screen.queryByText("任务二")).toBeNull();
    expect(screen.queryByText("任务三")).toBeNull();
    // 段仍在（「查看全部 3」入口可达归档）。
    expect(screen.getByRole("button", { name: /capsule.subagents.all/ }).textContent).toContain("3");
  });

  it("智能体段：「查看全部 N ›」显示终态数并进入归档；无终态时不渲染", () => {
    const onOpenSubagents = vi.fn();
    renderCapsule({
      subagents: {
        running: [item("c_live", "存活任务", "running")],
        completed: [item("c1", "任务一", "completed"), item("c2", "任务二", "completed")],
      },
      onOpenSubagents,
    });
    const row = screen.getByRole("button", { name: /capsule.subagents.all/ });
    // N = 终态数（存活行已直出，不计数）。
    expect(row.textContent).toContain("2");
    fireEvent.click(row);
    expect(onOpenSubagents).toHaveBeenCalledTimes(1);
  });

  it("智能体段：只有存活运行时无「查看全部」行（终态才进归档）", () => {
    renderCapsule({
      subagents: { running: [item("c_live", "存活任务", "running")], completed: [] },
    });
    expect(screen.queryByRole("button", { name: /capsule.subagents.all/ })).toBeNull();
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

  it("智能体两组皆空时段不渲染（不残留「查看全部」）", () => {
    renderCapsule({ subagents: { running: [], completed: [] } });
    expect(screen.queryByText("capsule.subagents")).toBeNull();
    expect(screen.queryByText("capsule.subagents.all")).toBeNull();
  });
});

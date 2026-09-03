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

  it("智能体段：存活行在上（带暂停钮）、已结束行在下，点标题直达该运行会话", () => {
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
    // 存活标题 → 打开该运行的会话记录
    fireEvent.click(screen.getByText("检索参考资料"));
    expect(onOpenSubagentRun).toHaveBeenCalledWith("c_live");
    // 已结束标题 → 同样直达会话记录
    fireEvent.click(screen.getByText("修复测试"));
    expect(onOpenSubagentRun).toHaveBeenCalledWith("c_done");
    // 暂停钮只取消，不打开
    fireEvent.click(screen.getByRole("button", { name: "capsule.subagents.pause" }));
    expect(onCancelSubagent).toHaveBeenCalledWith("c_live");
    expect(onOpenSubagentRun).toHaveBeenCalledTimes(2);
  });

  it("智能体段：存活行渲染顺序在已结束行之前", () => {
    renderCapsule({
      subagents: {
        running: [item("c_live", "存活任务", "running"), item("c_live2", "存活任务二", "started")],
        completed: [item("c_done", "完成任务", "completed")],
      },
    });
    const titles = ["存活任务", "存活任务二", "完成任务"].map((title) => screen.getByText(title));
    for (let index = 0; index < titles.length - 1; index += 1) {
      // Node.DOCUMENT_POSITION_FOLLOWING (4)：后一个元素在文档顺序上位于前一个之后。
      expect(titles[index]!.compareDocumentPosition(titles[index + 1]!) & 4).toBeTruthy();
    }
  });

  it("智能体段：已结束行最多直出两条，其余只经「查看全部」", () => {
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
    expect(screen.getByText("任务一")).toBeTruthy();
    expect(screen.getByText("任务二")).toBeTruthy();
    expect(screen.queryByText("任务三")).toBeNull();
  });

  it("智能体段：「查看全部 N ›」显示总数并进入本会话列表", () => {
    const onOpenSubagents = vi.fn();
    renderCapsule({
      subagents: {
        running: [item("c_live", "存活任务", "running")],
        completed: [item("c1", "任务一", "completed"), item("c2", "任务二", "completed")],
      },
      onOpenSubagents,
    });
    const row = screen.getByRole("button", { name: /capsule.subagents.all/ });
    expect(row.textContent).toContain("3");
    fireEvent.click(row);
    expect(onOpenSubagents).toHaveBeenCalledTimes(1);
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

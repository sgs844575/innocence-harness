// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentActivityCapsule, CAPSULE_SECTION_ORDER } from "./AgentActivityCapsule";

afterEach(cleanup);

const baseProps = {
  open: true,
  onToggleOpen: vi.fn(),
  expandedSections: ["environment", "process"] as const,
  onToggleSection: vi.fn(),
  environment: {
    branch: "main",
    changedFiles: 2,
    additions: 7,
    deletions: 3,
    workspaceKind: "git",
  },
  process: {
    todos: [{ content: "Implement capsule", status: "in_progress" as const }],
    completed: 2,
    total: 7,
    current: "Implement capsule",
    pending: 2,
    onOpen: vi.fn(),
  },
  terminal: { durationMs: 30_000, backgroundTasks: 1, onOpen: vi.fn() },
  agent: { name: "default", status: "running" as const },
  placement: "docked" as const,
};

describe("AgentActivityCapsule", () => {
  it("renders environment/Git before process, terminal, and agent", () => {
    render(<AgentActivityCapsule {...baseProps} />);
    const labels = screen.getAllByTestId(/^capsule-section-/).map((node) => node.getAttribute("data-section"));
    expect(labels).toEqual([...CAPSULE_SECTION_ORDER]);
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("+7")).toBeTruthy();
    expect(screen.getByText("−3")).toBeTruthy();
  });

  it("toggles child disclosure without changing the whole capsule", () => {
    const onToggleSection = vi.fn();
    render(<AgentActivityCapsule {...baseProps} onToggleSection={onToggleSection} />);
    fireEvent.click(screen.getByRole("button", { name: /终端/ }));
    expect(onToggleSection).toHaveBeenCalledWith("terminal");
    expect(baseProps.onToggleOpen).not.toHaveBeenCalled();
  });

  it("renders only sections present in the projection", () => {
    render(
      <AgentActivityCapsule
        {...baseProps}
        environment={undefined}
        process={undefined}
        terminal={undefined}
        expandedSections={[]}
      />,
    );
    expect(screen.queryByTestId("capsule-section-environment")).toBeNull();
    expect(screen.queryByTestId("capsule-section-process")).toBeNull();
    expect(screen.queryByTestId("capsule-section-terminal")).toBeNull();
    expect(screen.getByTestId("capsule-section-agent")).toBeTruthy();
  });

  it("renders Todo view model rows and preserves its open callback", () => {
    const onOpen = vi.fn();
    render(
      <AgentActivityCapsule
        {...baseProps}
        process={{
          todos: [
            { content: "完成投影", status: "completed" },
            { content: "当前任务", status: "in_progress" },
          ],
          completed: 1,
          total: 2,
          current: "当前任务",
          pending: 0,
          onOpen,
        }}
        expandedSections={["process"]}
      />,
    );
    expect(screen.getByText("完成投影")).toBeTruthy();
    expect(screen.getByText("当前任务")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "打开进程" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens a running child agent from the agent section", () => {
    const onOpenSubagent = vi.fn();
    render(
      <AgentActivityCapsule
        {...baseProps}
        subagents={[{ childId: "child-1", description: "研究子会话", status: "running", text: "读取中" }]}
        onOpenSubagent={onOpenSubagent}
        expandedSections={["agent"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /研究子会话/ }));
    expect(onOpenSubagent).toHaveBeenCalledWith("child-1");
  });

  it("keeps completed child agents rendered, clickable, and in incoming order", () => {
    const onOpenSubagent = vi.fn();
    render(
      <AgentActivityCapsule
        {...baseProps}
        subagents={[
          { childId: "child-done", description: "已完成子会话", status: "completed", text: "结果" },
          { childId: "child-run", description: "运行中子会话", status: "running", text: "进行中" },
          { childId: "child-failed", description: "失败子会话", status: "failed", text: "出错" },
        ]}
        onOpenSubagent={onOpenSubagent}
        expandedSections={["agent"]}
      />,
    );
    const labels = screen.getAllByRole("button", { name: /子会话/ }).map((node) => node.textContent);
    expect(labels).toEqual(["已完成子会话已完成", "运行中子会话运行中", "失败子会话失败"]);

    fireEvent.click(screen.getByRole("button", { name: /已完成子会话/ }));
    expect(onOpenSubagent).toHaveBeenCalledWith("child-done");
    fireEvent.click(screen.getByRole("button", { name: /失败子会话/ }));
    expect(onOpenSubagent).toHaveBeenCalledWith("child-failed");
  });
  it("shows only the current process when the whole capsule is collapsed", () => {
    render(<AgentActivityCapsule {...baseProps} open={false} />);
    expect(screen.getByText("Implement capsule")).toBeTruthy();
    expect(screen.queryByText("main")).toBeNull();
    expect(screen.queryByText("default")).toBeNull();
  });

  it("keeps a collapsed overlay capsule compact instead of stretching across the chat frame", () => {
    render(<AgentActivityCapsule {...baseProps} open={false} placement="overlay" />);
    expect(screen.getByLabelText("当前进程胶囊").className).toContain("agent-capsule-collapsed-compact");
  });

  it("forwards process and terminal navigation through injected commands", () => {
    const onProcessOpen = vi.fn();
    const onTerminalOpen = vi.fn();
    render(
      <AgentActivityCapsule
        {...baseProps}
        process={{ ...baseProps.process, onOpen: onProcessOpen }}
        terminal={{ ...baseProps.terminal, onOpen: onTerminalOpen }}
        expandedSections={["process", "terminal"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开进程" }));
    fireEvent.click(screen.getByRole("button", { name: "打开终端" }));
    expect(onProcessOpen).toHaveBeenCalledTimes(1);
    expect(onTerminalOpen).toHaveBeenCalledTimes(1);
  });
});

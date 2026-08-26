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

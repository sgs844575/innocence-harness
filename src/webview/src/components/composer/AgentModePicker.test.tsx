// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentModePicker } from "./AgentModePicker";

afterEach(cleanup);

const t = (key: string) => key;

const modes = [
  { id: "default", title: "Default" },
  { id: "plan", title: "Plan", description: "Research-first planning persona" },
  { id: "custom-x", title: "Custom X", description: "User mode hint" },
];

function renderPicker(value = "default", onChange = vi.fn()) {
  render(<AgentModePicker t={t} modes={modes} value={value} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "agentMode" }));
  return onChange;
}

describe("AgentModePicker", () => {
  it("内置 id 走 i18n 键并渲染描述行", () => {
    renderPicker();
    // t 透传键名：标题/描述即键名本身。
    expect(screen.getByText("agentMode.plan")).toBeTruthy();
    expect(screen.getByText("agentMode.plan.desc")).toBeTruthy();
    expect(screen.getByText("agentMode.default.desc")).toBeTruthy();
  });

  it("未知 id 回落目录原文（title/description）", () => {
    renderPicker();
    expect(screen.getByText("Custom X")).toBeTruthy();
    expect(screen.getByText("User mode hint")).toBeTruthy();
  });

  it("选择未知模式回传其 id；弹层限高可滚动", () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /Custom X/ }));
    expect(onChange).toHaveBeenCalledWith("custom-x");
    const popup = screen.getByText("agentMode.plan").closest("[data-radix-popper-content-wrapper]")
      ?.firstElementChild;
    expect(popup?.className).toMatch(/max-h-80/);
    expect(popup?.className).toMatch(/overflow-y-auto/);
  });

  it("选中项不在目录时触发器回落 default 展示", () => {
    render(
      <AgentModePicker t={t} modes={modes} value="removed-mode" onChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "agentMode" }).textContent).toContain("agentMode.default");
  });
});

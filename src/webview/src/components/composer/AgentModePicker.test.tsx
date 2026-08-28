// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentModePicker, labelFor, type AgentModeOption } from "./AgentModePicker";

afterEach(cleanup);

const t = (key: string) => {
  const dict: Record<string, string> = {
    "agentMode.select": "模式",
    "agentMode.default": "默认模式",
    "agentMode.creation": "创造模式",
  };
  return dict[key] ?? key;
};

const options: AgentModeOption[] = [
  { id: "default", title: "Default" },
  { id: "creation", title: "Creation" },
  { id: "custom-writer", title: "写作助手" },
];

describe("labelFor", () => {
  it("内置模式走 i18n 键（default/creation）", () => {
    const keys = (k: string) => k;
    expect(labelFor(keys, "default", options)).toBe("agentMode.default");
    expect(labelFor(keys, "creation", options)).toBe("agentMode.creation");
  });
  it("内置模式忽略元数据 title，显示翻译文案", () => {
    expect(labelFor(t, "default", options)).toBe("默认模式");
    expect(labelFor(t, "creation", options)).toBe("创造模式");
  });
  it("未知 id 回落目录中的 title", () => {
    expect(labelFor(t, "custom-writer", options)).toBe("写作助手");
  });
  it("目录缺失的 id 回落 id 本身", () => {
    expect(labelFor(t, "ghost-mode", options)).toBe("ghost-mode");
    expect(labelFor(t, "ghost-mode", [])).toBe("ghost-mode");
  });
});

describe("AgentModePicker", () => {
  it("触发 chip 显示当前值的 i18n 标签", () => {
    render(<AgentModePicker t={t} value="default" options={options} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "模式" }).textContent).toContain("默认模式");
  });
  it("自建模式显示元数据 title 并回调 onChange", () => {
    const onChange = vi.fn();
    render(<AgentModePicker t={t} value="creation" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "模式" }));
    fireEvent.click(screen.getByRole("button", { name: "写作助手" }));
    expect(onChange).toHaveBeenCalledWith("custom-writer");
  });
});

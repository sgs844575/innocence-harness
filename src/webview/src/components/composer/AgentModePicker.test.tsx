// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentModePicker, descFor, labelFor, type AgentModeOption } from "./AgentModePicker";

afterEach(cleanup);

const t = (key: string) => {
  const dict: Record<string, string> = {
    "agentMode.select": "模式",
    "agentMode.default": "默认模式",
    "agentMode.default.desc": "通用编程助手；提示词按项目特征自适应",
    "agentMode.creation": "创造模式",
    "agentMode.creation.desc": "按需求创作、安装并验证你自己的插件",
  };
  return dict[key] ?? key;
};

const options: AgentModeOption[] = [
  { id: "default", title: "Default" },
  { id: "creation", title: "Creation" },
  { id: "custom-writer", title: "写作助手", description: "自定义写作模式" },
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

describe("descFor", () => {
  it("内置模式走 i18n 描述键", () => {
    const keys = (k: string) => k;
    expect(descFor(keys, "default", options)).toBe("agentMode.default.desc");
    expect(descFor(keys, "creation", options)).toBe("agentMode.creation.desc");
    expect(descFor(t, "default", options)).toBe("通用编程助手；提示词按项目特征自适应");
  });
  it("用户模式回落元数据 description；缺失时为空串", () => {
    expect(descFor(t, "custom-writer", options)).toBe("自定义写作模式");
    expect(descFor(t, "ghost-mode", options)).toBe("");
  });
});

describe("AgentModePicker", () => {
  it("触发 chip 显示当前值的 i18n 标签与描述提示", () => {
    render(<AgentModePicker t={t} value="default" options={options} onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "模式" });
    expect(trigger.textContent).toContain("默认模式");
    expect(trigger.title).toBe("通用编程助手；提示词按项目特征自适应");
  });
  it("自建模式显示元数据 title 并回调 onChange", () => {
    const onChange = vi.fn();
    render(<AgentModePicker t={t} value="creation" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "模式" }));
    fireEvent.click(screen.getByRole("button", { name: "写作助手" }));
    expect(onChange).toHaveBeenCalledWith("custom-writer");
  });
});

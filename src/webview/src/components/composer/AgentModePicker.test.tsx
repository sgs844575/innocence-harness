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
    "agentMode.plan": "规划模式",
    "agentMode.plan.desc": "先调研再规划；计划批准前不动手实现",
    "agentMode.focus": "专注模式",
    "agentMode.focus.desc": "单任务深潜：不扩范围，读全相关文件再动手",
    "agentMode.minimal": "精简模式",
    "agentMode.minimal.desc": "最简执行：只报结论与必要证据，适合小改动",
    "agentMode.learning": "讲解模式",
    "agentMode.learning.desc": "边做边讲解：关键决策给理由，结束总结可复用要点",
    "agentMode.auto": "自主模式",
    "agentMode.auto.desc": "授权范围内连续推进任务清单；周期自检、按产出调节奏，里程碑与失败才通报",
    "agentMode.coordinator": "协同模式",
    "agentMode.coordinator.desc": "分解目标分派队友与子代理；简报自包含、回复核实后整合，方案经批准才执行",
  };
  return dict[key] ?? key;
};

const options: AgentModeOption[] = [
  { id: "default", title: "Default" },
  { id: "creation", title: "Creation" },
  { id: "custom-writer", title: "写作助手", description: "自定义写作模式" },
];

describe("labelFor", () => {
  it("内置模式走 i18n 键（default/creation/plan/focus/minimal/learning/auto/coordinator）", () => {
    const keys = (k: string) => k;
    expect(labelFor(keys, "default", options)).toBe("agentMode.default");
    expect(labelFor(keys, "creation", options)).toBe("agentMode.creation");
    // 单模式插件：staging id = 注册模式 id，同走内建 i18n 分支（auto 为
    // B4D 遗后补枚举，coordinator 为 B4E 新增——选择器测试枚举新 id）。
    expect(labelFor(keys, "plan", options)).toBe("agentMode.plan");
    expect(labelFor(keys, "focus", options)).toBe("agentMode.focus");
    expect(labelFor(keys, "minimal", options)).toBe("agentMode.minimal");
    expect(labelFor(keys, "learning", options)).toBe("agentMode.learning");
    expect(labelFor(keys, "auto", options)).toBe("agentMode.auto");
    expect(labelFor(keys, "coordinator", options)).toBe("agentMode.coordinator");
  });
  it("内置模式忽略元数据 title，显示翻译文案", () => {
    expect(labelFor(t, "default", options)).toBe("默认模式");
    expect(labelFor(t, "creation", options)).toBe("创造模式");
    expect(labelFor(t, "plan", options)).toBe("规划模式");
  });
  it("单模式插件的描述同样走 i18n 键（与 label 同一内建集合）", () => {
    const keys = (k: string) => k;
    expect(descFor(keys, "plan", options)).toBe("agentMode.plan.desc");
    expect(descFor(keys, "focus", options)).toBe("agentMode.focus.desc");
    expect(descFor(keys, "minimal", options)).toBe("agentMode.minimal.desc");
    expect(descFor(keys, "learning", options)).toBe("agentMode.learning.desc");
    expect(descFor(keys, "auto", options)).toBe("agentMode.auto.desc");
    expect(descFor(keys, "coordinator", options)).toBe("agentMode.coordinator.desc");
    // 翻译命中：忽略清单投影的英文包描述。
    expect(descFor(t, "plan", [{ id: "plan", title: "Plan", description: "Research-first planning persona" }]))
      .toBe("先调研再规划；计划批准前不动手实现");
    const coordinatorOption = [{ id: "coordinator", title: "Coordinator", description: "Orchestration persona" }];
    expect(labelFor(t, "coordinator", coordinatorOption)).toBe("协同模式");
    expect(descFor(t, "coordinator", coordinatorOption))
      .toBe("分解目标分派队友与子代理；简报自包含、回复核实后整合，方案经批准才执行");
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

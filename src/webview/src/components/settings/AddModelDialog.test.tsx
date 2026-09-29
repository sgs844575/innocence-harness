// @vitest-environment jsdom
// 「添加模型」弹窗测试：智能配置按名称匹配清单回填、参数映射 JSON 校验、
// 推理等级动态列表、重置表单与保存载荷形状。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "../../../../shared/ipc";
import { AddModelDialog } from "./AddModelDialog";

afterEach(cleanup);

const t = (key: string) => key;

function renderDialog(extra: Partial<Parameters<typeof AddModelDialog>[0]> = {}) {
  return render(<AddModelDialog t={t} onClose={() => {}} onSave={() => {}} {...extra} />);
}

const MATCHED: ModelInfo = {
  id: "gpt-5",
  name: "GPT-5",
  source: "preset",
  contextWindow: 400000,
  maxOutput: 128000,
  vision: true,
  pdf: true,
  tools: true,
  reasoning: true,
  reasoningEfforts: ["low", "medium", "high"],
  reasoningParamMap: { max: "xhigh" },
  structuredOutput: true,
  webSearch: true,
  systemMessage: true,
};

describe("AddModelDialog 智能配置", () => {
  it("按名称匹配清单回填全表单（数值/勾选/推理等级/参数映射）", async () => {
    const onMatch = vi.fn(async () => MATCHED);
    renderDialog({ onMatch });
    fireEvent.change(screen.getByPlaceholderText("settings.models.dialog.modelId"), { target: { value: "gpt-5.1-mini" } });
    await waitFor(() => expect(screen.getByTestId("smart-match-hint")).toBeTruthy());
    expect(onMatch).toHaveBeenCalledWith("gpt-5.1-mini");
    expect((screen.getByLabelText("settings.models.dialog.contextWindow") as HTMLInputElement).value).toBe("400000");
    expect((screen.getByLabelText("settings.models.dialog.maxOutput") as HTMLInputElement).value).toBe("128000");
    expect((screen.getByLabelText("settings.models.dialog.image") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("settings.models.dialog.pdf") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("settings.models.dialog.structuredOutput") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("settings.models.dialog.systemMessage") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("settings.models.dialog.paramMap") as HTMLTextAreaElement).value).toContain("xhigh");
    expect(screen.getByText("low")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
  });

  it("未命中不回填、不显示提示；关闭开关不发起匹配", async () => {
    const onMatch = vi.fn(async () => null);
    renderDialog({ onMatch });
    fireEvent.change(screen.getByPlaceholderText("settings.models.dialog.modelId"), { target: { value: "mystery" } });
    await waitFor(() => expect(onMatch).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("smart-match-hint")).toBeNull();
    expect((screen.getByLabelText("settings.models.dialog.contextWindow") as HTMLInputElement).value).toBe("1000000");

    fireEvent.click(screen.getByRole("switch", { name: "settings.models.dialog.smartConfig" }));
    fireEvent.change(screen.getByPlaceholderText("settings.models.dialog.modelId"), { target: { value: "another" } });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(onMatch).toHaveBeenCalledTimes(1);
  });
});

describe("AddModelDialog 高级配置", () => {
  it("参数映射非法 JSON 阻断保存并提示错误", () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("settings.models.dialog.modelId"), { target: { value: "custom-model" } });
    fireEvent.change(screen.getByLabelText("settings.models.dialog.paramMap"), { target: { value: "{not-json" } });
    expect(screen.getByTestId("param-map-error").textContent).toContain("settings.models.dialog.paramMap.invalid");
    expect((screen.getByRole("button", { name: "settings.models.save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("参数映射非字符串值对象同样阻断；合法对象放行", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("settings.models.dialog.paramMap"), { target: { value: "{\"max\": 3}" } });
    expect(screen.getByTestId("param-map-error")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("settings.models.dialog.paramMap"), { target: { value: "{\"max\": \"xhigh\"}" } });
    expect(screen.queryByTestId("param-map-error")).toBeNull();
  });

  it("推理等级：添加/移除档位并随保存下发", () => {
    const onSave = vi.fn();
    renderDialog({ onSave });
    fireEvent.change(screen.getByPlaceholderText("settings.models.dialog.modelId"), { target: { value: "custom-model" } });
    const levelInput = screen.getByLabelText("settings.models.dialog.reasoningLevels");
    fireEvent.change(levelInput, { target: { value: "low" } });
    fireEvent.click(screen.getByRole("button", { name: "settings.models.dialog.addLevel" }));
    fireEvent.change(levelInput, { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "settings.models.dialog.addLevel" }));
    // 移除 low
    fireEvent.click(screen.getByRole("button", { name: "settings.models.dialog.removeLevel low" }));
    fireEvent.click(screen.getByRole("button", { name: "settings.models.save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const model = onSave.mock.calls[0]![0] as ModelInfo;
    expect(model.reasoningEfforts).toEqual(["high"]);
  });

  it("保存载荷携带勾选的能力与输入类型；重置表单清空", () => {
    const onSave = vi.fn();
    renderDialog({ onSave });
    fireEvent.change(screen.getByPlaceholderText("settings.models.dialog.modelId"), { target: { value: "custom-model" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "settings.models.dialog.video" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "settings.models.dialog.webSearch" }));
    fireEvent.click(screen.getByRole("button", { name: "settings.models.save" }));
    const model = onSave.mock.calls[0]![0] as ModelInfo;
    expect(model.video).toBe(true);
    expect(model.webSearch).toBe(true);
    expect(model.pdf).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "settings.models.dialog.reset" }));
    expect((screen.getByPlaceholderText("settings.models.dialog.modelId") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("settings.models.dialog.contextWindow") as HTMLInputElement).value).toBe("1000000");
    expect((screen.getByRole("checkbox", { name: "settings.models.dialog.video" }) as HTMLInputElement).checked).toBe(false);
  });
});

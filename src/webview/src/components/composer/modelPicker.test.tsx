// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";
import type { HarnessSettings } from "../../../../shared/ipc";

afterEach(cleanup);

const settings = {
  profiles: [
    { id: "p1", name: "智谱", kind: "openai", apiKey: "", baseURL: "", enabled: true,
      models: [{ id: "glm-4.6", name: "GLM-4.6", source: "preset", tools: true, contextWindow: 200000 }] },
  ],
} as unknown as HarnessSettings;

describe("ModelPicker", () => {
  it("打开面板、选择模型回调、chip 显示供应商和模型名", async () => {
    const onSelect = vi.fn();
    render(<ModelPicker settings={settings} activeProfileId="p1" activeModel="glm-4.6" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /智谱 \/ GLM-4.6/ }));
    await waitFor(() => screen.getByText("智谱"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /GLM-4.6/ }));
    expect(onSelect).toHaveBeenCalledWith("p1", "glm-4.6");
  });

  it("空名称按供应商 kind 回退且改名后立即更新 chip", () => {
    const unnamed = {
      ...settings,
      profiles: [{ ...settings.profiles[0]!, name: "" }],
    } as HarnessSettings;
    const { rerender } = render(<ModelPicker settings={unnamed} activeProfileId="p1" activeModel="glm-4.6" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /OpenAI \/ GLM-4.6/ })).toBeTruthy();

    const renamed = {
      ...unnamed,
      profiles: [{ ...unnamed.profiles[0]!, name: "自定义供应商" }],
    } as HarnessSettings;
    rerender(<ModelPicker settings={renamed} activeProfileId="p1" activeModel="glm-4.6" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /自定义供应商 \/ GLM-4.6/ })).toBeTruthy();
  });

  it("同一模型在不同供应商下显示不同供应商标签", () => {
    const duplicateModelSettings = {
      ...settings,
      profiles: [
        { ...settings.profiles[0]!, name: "供应商一" },
        { ...settings.profiles[0]!, id: "p2", name: "供应商二" },
      ],
    } as HarnessSettings;
    const { rerender } = render(<ModelPicker settings={duplicateModelSettings} activeProfileId="p1" activeModel="glm-4.6" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /供应商一 \/ GLM-4.6/ })).toBeTruthy();
    rerender(<ModelPicker settings={duplicateModelSettings} activeProfileId="p2" activeModel="glm-4.6" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /供应商二 \/ GLM-4.6/ })).toBeTruthy();
  });

  it("显示 native generative transport badge", async () => {
    const nativeSettings = {
      ...settings,
      profiles: [...settings.profiles, {
        id: "native", name: "Native", kind: "google" as const, apiKey: "", baseURL: "", enabled: true,
        models: [{ id: "gemini-2.5-pro", source: "preset" as const }],
      }],
    } as HarnessSettings;
    render(<ModelPicker settings={nativeSettings} activeProfileId="p1" activeModel="glm-4.6" onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /智谱 \/ GLM-4.6/ }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    expect(within(dialog).getByText("google-generative")).toBeTruthy();
  });

  it("大量模型/厂家时双列各自滚动且面板限高（防溢出回归）", async () => {
    const manyModels = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, source: "preset" as const }));
    const manyProfiles = Array.from({ length: 30 }, (_, i) => ({
      id: `p${i}`, name: `厂家${i}`, kind: "openai" as const, apiKey: "", baseURL: "", enabled: true, models: manyModels,
    }));
    const big = { profiles: manyProfiles } as unknown as HarnessSettings;
    render(<ModelPicker settings={big} activeProfileId="p0" activeModel="m0" onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /厂家0 \/ m0/ }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    expect(within(dialog).getAllByRole("button", { name: /m\d+/ })).toHaveLength(80);
    const panes = dialog.querySelectorAll(".overflow-y-auto");
    expect(panes.length).toBeGreaterThanOrEqual(2);
    for (const pane of panes) expect(pane.className).toContain("scrollbar-thin");
    const shell = panes[0]!.parentElement!;
    expect(shell.className).toContain("max-h-");
  });
});

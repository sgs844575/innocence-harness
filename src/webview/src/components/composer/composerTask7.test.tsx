// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../Composer";
import type { HarnessSettings } from "../../../../shared/ipc";

afterEach(cleanup);

const settings = {
  profiles: [{ id: "p1", name: "Provider", kind: "openai", apiKey: "", baseURL: "", enabled: true, models: [{ id: "model-1", source: "preset" }] }],
  activeProfileId: "p1",
  activeModel: "model-1",
  workspaceRoot: "D:/workspace",
  permissionMode: "full",
  activeAgent: "default",
  reasoningEffort: "high",
} as unknown as HarnessSettings;
const t = (key: string) => key;

describe("task 7 Composer states", () => {
  it("landing shows project selection, @ and / guidance, access, model, and send", () => {
    render(<Composer t={t} mode="landing" streaming={false} settings={settings} onSettingsChange={() => {}} onSend={() => {}} onStop={() => {}} header={<button type="button">选择项目</button>} />);
    expect(screen.getByRole("button", { name: "选择项目" })).toBeTruthy();
    expect(screen.getByText(/使用 @ 添加上下文/)).toBeTruthy();
    expect(screen.getByText(/使用 \/ 选择命令/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /permission.mode.full/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "chat.send" })).toBeTruthy();
  });

  it("existing session hides project selection and exposes context count plus model and thinking", () => {
    render(<Composer t={t} mode="existing" contextCount={3} streaming={false} settings={settings} onSettingsChange={() => {}} onSend={() => {}} onStop={() => {}} header={<button type="button">选择项目</button>} />);
    expect(screen.queryByRole("button", { name: "选择项目" })).toBeNull();
    expect(screen.getByPlaceholderText("chat.placeholder.followUp")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Provider \/ model-1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reasoning\.effort/ })).toBeTruthy();
  });

  it("uses stop instead of send while streaming", () => {
    const onStop = vi.fn();
    render(<Composer t={t} mode="existing" streaming settings={settings} onSettingsChange={() => {}} onSend={() => {}} onStop={onStop} />);
    fireEvent.click(screen.getByRole("button", { name: "chat.stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "chat.send" })).toBeNull();
  });
});

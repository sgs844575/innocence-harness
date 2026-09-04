// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessSettings } from "../../../../shared/ipc";
import { OnboardingDialog } from "./OnboardingDialog";

afterEach(cleanup);

const t = (key: string) => key;

const settings = {
  locale: "zh-CN",
  themeMode: "dark",
  permissionMode: "ask",
} as unknown as HarnessSettings;

function renderDialog(extra: Partial<Parameters<typeof OnboardingDialog>[0]> = {}) {
  return render(
    <OnboardingDialog t={t} settings={settings} onFinish={() => {}} onSkip={() => {}} {...extra} />,
  );
}

/** Radix Popover 触发器在 click 时开合（与 GeneralPanel 测试同一口径）。 */
function openSelect(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("OnboardingDialog 渲染", () => {
  it("三个下拉与完成/跳过按钮齐全", () => {
    renderDialog();
    expect(screen.getByText("onboarding.title")).toBeTruthy();
    expect(screen.getByText("onboarding.subtitle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "settings.general.language" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "settings.appearance.theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "settings.general.permission" })).toBeTruthy();
    // 遮罩与底栏跳过钮同名，底栏钮在 DOM 末尾。
    const skipButtons = screen.getAllByRole("button", { name: "onboarding.skip" });
    expect(skipButtons.length).toBe(2);
    expect(screen.getByRole("button", { name: "onboarding.finish" })).toBeTruthy();
  });

  it("草稿初值取当前设置", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "settings.general.language" }).textContent).toContain("简体中文");
    expect(screen.getByRole("button", { name: "settings.appearance.theme" }).textContent).toContain("深色");
    expect(screen.getByRole("button", { name: "settings.general.permission" }).textContent).toContain(
      "permission.mode.ask",
    );
  });
});

describe("OnboardingDialog 提交", () => {
  it("未改动时完成回传当前设置值", () => {
    const onFinish = vi.fn();
    renderDialog({ onFinish });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.finish" }));
    expect(onFinish).toHaveBeenCalledWith({ locale: "zh-CN", themeMode: "dark", permissionMode: "ask" });
  });

  it("完成回传草稿改动", () => {
    const onFinish = vi.fn();
    renderDialog({ onFinish });
    openSelect("settings.general.language");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    openSelect("settings.appearance.theme");
    fireEvent.click(screen.getByRole("button", { name: "浅色" }));
    openSelect("settings.general.permission");
    fireEvent.click(screen.getByRole("button", { name: "permission.mode.full" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.finish" }));
    expect(onFinish).toHaveBeenCalledWith({ locale: "en-US", themeMode: "light", permissionMode: "full" });
  });
});

describe("OnboardingDialog 跳过", () => {
  it("底栏跳过钮触发 onSkip", () => {
    const onSkip = vi.fn();
    renderDialog({ onSkip });
    const skipButtons = screen.getAllByRole("button", { name: "onboarding.skip" });
    fireEvent.click(skipButtons[skipButtons.length - 1]);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("Esc 触发 onSkip", () => {
    const onSkip = vi.fn();
    renderDialog({ onSkip });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("遮罩点击触发 onSkip", () => {
    const onSkip = vi.fn();
    renderDialog({ onSkip });
    fireEvent.click(screen.getAllByRole("button", { name: "onboarding.skip" })[0]);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

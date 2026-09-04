// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppInfo, HarnessSettings } from "../../../../shared/ipc";
import { GeneralPanel } from "./GeneralPanel";

afterEach(cleanup);

const t = (key: string) => key;

const settings = {
  profiles: [],
  activeProfileId: "",
  activeModel: "",
  workspaceRoot: "",
  permissionMode: "ask",
} as unknown as HarnessSettings;

function renderPanel(extra: Partial<Parameters<typeof GeneralPanel>[0]> = {}) {
  return render(
    <GeneralPanel t={t} settings={settings} appInfo={null} onPatchSettings={() => {}} {...extra} />,
  );
}

/** Radix Popover 触发器在 click 时开合（DropdownMenu 才是 pointerdown）。 */
function openSelect(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("GeneralPanel 渲染", () => {
  it("页标题与全部卡片行按 key 渲染", () => {
    renderPanel();
    expect(screen.getByText("settings.section.general")).toBeTruthy();
    for (const key of [
      "settings.general.language",
      "settings.general.permission",
      "settings.general.terminalInherit",
      "settings.general.terminalFont",
      "settings.general.terminalShell",
      "settings.general.enhancedFindGrep",
      "settings.general.httpProxy",
      "settings.general.proxyBypass",
      "settings.general.customCaCert",
      "settings.general.hardwareAccel",
      "settings.general.previewUpdates",
      "settings.general.autoUpdates",
      "settings.general.taskNotifications",
      "settings.general.notificationSound",
      "settings.general.closeToTray",
      "settings.general.keepAwake",
      "settings.general.interactionMode",
      "settings.general.questionAutoContinue",
      "settings.general.showThinking",
      "settings.general.showTodos",
      "settings.general.groupExplore",
      "settings.general.groupTerminal",
      "settings.general.groupChanges",
      "settings.general.autoArchive",
      "settings.general.archiveRetention",
      "settings.general.telemetry",
    ]) {
      expect(screen.getByText(key)).toBeTruthy();
    }
  });

  it("占位符走 placeholder key", () => {
    renderPanel();
    expect(screen.getByPlaceholderText("settings.general.terminalFont.placeholder")).toBeTruthy();
    expect(screen.getByPlaceholderText("settings.general.httpProxy.placeholder")).toBeTruthy();
    expect(screen.getByPlaceholderText("settings.general.proxyBypass.placeholder")).toBeTruthy();
    expect(screen.getByPlaceholderText("settings.general.customCaCert.placeholder")).toBeTruthy();
  });
});

describe("GeneralPanel 开关", () => {
  it("默认开启的字段点击后写入 false，默认关闭的写入 true", () => {
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings });
    fireEvent.click(screen.getByRole("switch", { name: "settings.general.terminalInherit" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ terminalInheritProfile: false });
    fireEvent.click(screen.getByRole("switch", { name: "settings.general.hardwareAccel" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ hardwareAcceleration: false });
    fireEvent.click(screen.getByRole("switch", { name: "settings.general.showThinking" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ showThinking: false });
    fireEvent.click(screen.getByRole("switch", { name: "settings.general.groupTerminal" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ groupTerminalCommands: false });
    fireEvent.click(screen.getByRole("switch", { name: "settings.general.keepAwake" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ keepAwake: true });
    fireEvent.click(screen.getByRole("switch", { name: "settings.general.groupChanges" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ groupFileChanges: true });
    fireEvent.click(screen.getByRole("switch", { name: "settings.general.autoArchive" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ autoArchiveTasks: true });
    fireEvent.click(screen.getByRole("switch", { name: "settings.general.telemetry" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ telemetryOptIn: true });
  });

  it("非 win32 平台「隐藏到托盘」开关禁用，win32 可切换", () => {
    const onPatchSettings = vi.fn();
    const darwin = { version: "1.0.0", platform: "darwin", locale: "zh-CN" } as AppInfo;
    const { unmount } = renderPanel({ appInfo: darwin, onPatchSettings });
    const disabledToggle = screen.getByRole("switch", { name: "settings.general.closeToTray" });
    expect((disabledToggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(disabledToggle);
    expect(onPatchSettings).not.toHaveBeenCalled();
    unmount();

    const win32 = { version: "1.0.0", platform: "win32", locale: "zh-CN" } as AppInfo;
    renderPanel({ appInfo: win32, onPatchSettings });
    fireEvent.click(screen.getByRole("switch", { name: "settings.general.closeToTray" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ closeToTray: true });
  });
});

describe("GeneralPanel 文本保存行", () => {
  it("未改动时保存禁用，改动后保存去首尾空白", () => {
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings });
    const input = screen.getByLabelText("settings.general.httpProxy");
    const save = screen.getAllByRole("button", { name: "settings.general.save" })[1];
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "  http://127.0.0.1:7890  " } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    expect(onPatchSettings).toHaveBeenCalledWith({ httpProxy: "http://127.0.0.1:7890" });
  });

  it("回车提交终端字体", () => {
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings });
    const input = screen.getByLabelText("settings.general.terminalFont");
    fireEvent.change(input, { target: { value: "JetBrains Mono" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPatchSettings).toHaveBeenCalledWith({ terminalFontFamily: "JetBrains Mono" });
  });
});

describe("GeneralPanel 下拉", () => {
  it("界面语言写入 locale", () => {
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings });
    openSelect("settings.general.language");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ locale: "en-US" });
  });

  it("终端 Shell 写入 terminalShell", () => {
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings });
    openSelect("settings.general.terminalShell");
    fireEvent.click(screen.getByRole("button", { name: "powershell" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ terminalShell: "powershell" });
  });

  it("交互行为写入 interactionMode", () => {
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings });
    openSelect("settings.general.interactionMode");
    fireEvent.click(screen.getByRole("button", { name: "settings.general.interactionMode.steer" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ interactionMode: "steer" });
  });

  it("归档保留时长写入数字 archiveRetentionDays", () => {
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings });
    openSelect("settings.general.archiveRetention");
    fireEvent.click(screen.getByRole("button", { name: "settings.general.archiveRetention.d30" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ archiveRetentionDays: 30 });
    const patch = onPatchSettings.mock.calls[0][0] as { archiveRetentionDays: unknown };
    expect(typeof patch.archiveRetentionDays).toBe("number");
  });
});

describe("GeneralPanel 可选卡片", () => {
  it("无 dataRoot/onOpenOnboarding 时数据目录与引导卡片不渲染", () => {
    renderPanel();
    expect(screen.queryByText("settings.general.dataRoot")).toBeNull();
    expect(screen.queryByText("settings.general.onboarding")).toBeNull();
  });

  it("数据目录卡片展示路径并触发选择回调", () => {
    const onChangeDataRoot = vi.fn();
    renderPanel({ dataRoot: "C:\\Users\\me\\.innocence", onChangeDataRoot });
    expect(screen.getByText("C:\\Users\\me\\.innocence")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "settings.general.dataRoot.pick" }));
    expect(onChangeDataRoot).toHaveBeenCalledTimes(1);
  });

  it("引导卡片按钮触发回调", () => {
    const onOpenOnboarding = vi.fn();
    renderPanel({ onOpenOnboarding });
    fireEvent.click(screen.getByRole("button", { name: "settings.general.onboarding.open" }));
    expect(onOpenOnboarding).toHaveBeenCalledTimes(1);
  });
});

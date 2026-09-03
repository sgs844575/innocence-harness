// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessSettings } from "../../../shared/ipc";
import { SettingsView } from "./SettingsView";

afterEach(cleanup);

const t = (key: string) => key;

const settings = {
  profiles: [],
  activeProfileId: "",
  activeModel: "",
  workspaceRoot: "",
  permissionMode: "ask",
  themeMode: "dark",
  uiFontSize: 14,
  codeFontSize: 14,
  codeThemeLight: "github-light",
  codeThemeDark: "github-dark",
  codeLineNumbers: true,
  codeWordWrap: false,
} as unknown as HarnessSettings;

function renderAppearance(extra: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  return render(
    <SettingsView
      t={t}
      settings={settings}
      appInfo={null}
      section="appearance"
      onPatchSettings={() => {}}
      onSetTheme={() => {}}
      {...extra}
    />,
  );
}

describe("SettingsView 外观分区", () => {
  it("界面设置/代码设置/代码预览三组齐全，主题与字号控件在", () => {
    renderAppearance();
    expect(screen.getByText("settings.appearance.uiGroup")).toBeTruthy();
    expect(screen.getByText("settings.appearance.codeGroup")).toBeTruthy();
    expect(screen.getByText("settings.appearance.preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "settings.appearance.theme" })).toBeTruthy();
    expect(screen.getByLabelText("settings.appearance.fontSize")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "settings.appearance.lineNumbers" })).toBeTruthy();
  });

  it("关闭行号/开启换行走补丁", () => {
    const onPatchSettings = vi.fn();
    renderAppearance({ onPatchSettings });
    fireEvent.click(screen.getByRole("switch", { name: "settings.appearance.lineNumbers" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ codeLineNumbers: false });
    fireEvent.click(screen.getByRole("switch", { name: "settings.appearance.wordWrap" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ codeWordWrap: true });
  });

  it("字号提交收窄到 12..18", () => {
    const onPatchSettings = vi.fn();
    renderAppearance({ onPatchSettings });
    const input = screen.getByLabelText("settings.appearance.fontSize");
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPatchSettings).toHaveBeenCalledWith({ uiFontSize: 18 });
  });

  it("浅色主题下浅色预览带「当前生效」徽章", () => {
    renderAppearance({ resolvedTheme: "light" });
    expect(screen.getByText("settings.appearance.preview.current")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSidebar } from "./SettingsSidebar";

afterEach(cleanup);

const t = (key: string) => key;

describe("SettingsSidebar", () => {
  it("places server settings directly below plugins", () => {
    render(<SettingsSidebar t={t} section="mcp" onSelect={() => {}} onBack={() => {}} />);
    const names = screen.getAllByRole("button").map((button) => button.textContent);
    expect(names.indexOf("settings.section.mcp")).toBe(names.indexOf("settings.section.plugins") + 1);
  });
  it("places memory in the agent capabilities group", () => {
    const onSelect = vi.fn();
    render(<SettingsSidebar t={t} section="memory" onSelect={onSelect} onBack={() => {}} />);
    const group = screen.getByRole("region", { name: "settings.group.agent" });
    const button = within(group).getByRole("button", { name: "settings.section.memory" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("memory");
  });
  it("基础设置中浏览器紧随模型，关于归入帮助", () => {
    render(<SettingsSidebar t={t} section="general" onSelect={() => {}} onBack={() => {}} />);
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    const order = ["settings.section.general", "settings.section.appearance", "settings.section.models", "settings.section.browser", "settings.section.computer", "settings.section.about"];
    const positions = order.map((label) => buttons.findIndex((text) => text === label));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const basic = screen.getByRole("region", { name: "settings.group.basic" });
    const help = screen.getByRole("region", { name: "settings.group.help" });
    expect(within(basic).getByRole("button", { name: "settings.section.browser" })).toBeTruthy();
    expect(within(basic).getByRole("button", { name: "settings.section.computer" })).toBeTruthy();
    expect(within(basic).queryByRole("button", { name: "settings.section.about" })).toBeNull();
    expect(within(help).getByRole("button", { name: "settings.section.about" })).toBeTruthy();
  });

  it("点击分区回调 onSelect，返回钮回调 onBack", () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    render(<SettingsSidebar t={t} section="general" onSelect={onSelect} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /settings.section.models/ }));
    expect(onSelect).toHaveBeenCalledWith("models");
    fireEvent.click(screen.getByRole("button", { name: "settings.section.browser" }));
    expect(onSelect).toHaveBeenCalledWith("browser");
    fireEvent.click(screen.getByRole("button", { name: "settings.section.computer" }));
    expect(onSelect).toHaveBeenCalledWith("computer");
    fireEvent.click(screen.getByRole("button", { name: /settings.back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("当前分区高亮（aria-pressed）", () => {
    render(<SettingsSidebar t={t} section="appearance" onSelect={() => {}} onBack={() => {}} />);
    expect(screen.getByRole("button", { name: /settings.section.appearance/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /settings.section.general/ }).getAttribute("aria-pressed")).toBe("false");
  });
});

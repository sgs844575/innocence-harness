// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSidebar } from "./SettingsSidebar";

afterEach(cleanup);

const t = (key: string) => key;

describe("SettingsSidebar", () => {
  it("按 常规/外观/模型服务/关于 顺序渲染分区导航", () => {
    render(<SettingsSidebar t={t} section="general" onSelect={() => {}} onBack={() => {}} />);
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    const order = ["settings.section.general", "settings.section.appearance", "settings.section.models", "settings.section.about"];
    const positions = order.map((label) => buttons.findIndex((text) => text === label));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("点击分区回调 onSelect，返回钮回调 onBack", () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    render(<SettingsSidebar t={t} section="general" onSelect={onSelect} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /settings.section.models/ }));
    expect(onSelect).toHaveBeenCalledWith("models");
    fireEvent.click(screen.getByRole("button", { name: /settings.back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("当前分区高亮（aria-pressed）", () => {
    render(<SettingsSidebar t={t} section="appearance" onSelect={() => {}} onBack={() => {}} />);
    expect(screen.getByRole("button", { name: /settings.section.appearance/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /settings.section.general/ }).getAttribute("aria-pressed")).toBe("false");
  });
});

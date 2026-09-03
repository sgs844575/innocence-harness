// @vitest-environment jsdom
// BrowserView：jsdom 无 <webview> 实现（未知元素、无方法）——验证空态、地址栏
// 回车首载（src 挂载）、导航按钮禁用态、设备/…菜单。桥方法经 lib/ipc mock。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const browserEmulate = vi.fn(async (_request: unknown) => ({ ok: true }));
vi.mock("../lib/ipc", () => ({
  hasBridge: () => true,
  api: { browserEmulate: (req: unknown) => browserEmulate(req), openExternal: vi.fn(async () => {}) },
}));

import { BrowserView } from "./BrowserView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const t = (key: string) => key;

describe("BrowserView", () => {
  it("空态：Globe + 提示文案 + 地址栏占位；不渲染访客页", () => {
    const { container } = render(<BrowserView t={t} onTitleChange={() => {}} />);
    expect(screen.getByText("dock.tile.browser")).toBeTruthy();
    expect(screen.getByText("dock.browser.emptyHint")).toBeTruthy();
    expect(screen.getByLabelText("dock.browser.placeholder")).toBeTruthy();
    expect(container.querySelector("webview")).toBeNull();
  });

  it("地址栏回车首载：归一化后挂载 webview（src = 补全协议的 URL）", () => {
    const { container } = render(<BrowserView t={t} onTitleChange={() => {}} />);
    const input = screen.getByLabelText("dock.browser.placeholder");
    fireEvent.change(input, { target: { value: "baidu.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const view = container.querySelector("webview");
    expect(view).not.toBeNull();
    expect(view!.getAttribute("src")).toBe("https://baidu.com/");
    expect(view!.getAttribute("partition")).toBe("persist:browser");
  });

  it("非法协议（file:）不挂载访客页", () => {
    const { container } = render(<BrowserView t={t} onTitleChange={() => {}} />);
    const input = screen.getByLabelText("dock.browser.placeholder");
    fireEvent.change(input, { target: { value: "file:///etc/passwd" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(container.querySelector("webview")).toBeNull();
  });

  it("设备菜单：适应窗口 / 手机预设；手机档调用 browser:emulate", () => {
    render(<BrowserView t={t} onTitleChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("dock.browser.device"));
    expect(screen.getByText("dock.browser.fit")).toBeTruthy();
    expect(screen.getByText(/dock\.browser\.mobile/)).toBeTruthy();
    // 未建访客（guestId 未知）时不发仿真请求
    fireEvent.click(screen.getByText(/dock\.browser\.mobile/));
    expect(browserEmulate).not.toHaveBeenCalled();
  });

  it("… 菜单：默认浏览器打开（无页面时禁用）+ 打开调试工具", () => {
    render(<BrowserView t={t} onTitleChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("dock.browser.more"));
    const openExternal = screen.getByText("dock.browser.openExternal").closest("button")!;
    expect(openExternal.disabled).toBe(true);
    expect(screen.getByText("dock.browser.devtools")).toBeTruthy();
  });
});

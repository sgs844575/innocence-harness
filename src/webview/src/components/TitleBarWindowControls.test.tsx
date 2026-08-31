// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";

const {
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  isWindowMaximized,
  onWindowMaximizedChanged,
} = vi.hoisted(() => ({
  minimizeWindow: vi.fn(() => Promise.resolve()),
  toggleMaximizeWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  isWindowMaximized: vi.fn(() => Promise.resolve(false)),
  onWindowMaximizedChanged: vi.fn((_cb: (maximized: boolean) => void) => () => {}),
}));

vi.mock("../lib/ipc", () => ({
  api: {
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    isWindowMaximized,
    onWindowMaximizedChanged,
  },
}));

import { TitleBarWindowControls } from "./TitleBarWindowControls";

describe("TitleBarWindowControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("renders the three window controls and queries maximize state once", () => {
    render(<TitleBarWindowControls />);
    expect(screen.getByRole("button", { name: "最小化" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "最大化" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
    expect(isWindowMaximized).toHaveBeenCalledOnce();
    expect(onWindowMaximizedChanged).toHaveBeenCalledOnce();
  });

  it("dispatches minimize/toggle/close through the bridge on click", () => {
    render(<TitleBarWindowControls />);
    fireEvent.click(screen.getByRole("button", { name: "最小化" }));
    expect(minimizeWindow).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "最大化" }));
    expect(toggleMaximizeWindow).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it("switches the maximize button label when the state event fires", () => {
    let notify: ((maximized: boolean) => void) | undefined;
    onWindowMaximizedChanged.mockImplementation((cb: (v: boolean) => void) => {
      notify = cb;
      return () => {};
    });
    render(<TitleBarWindowControls />);
    expect(screen.getByRole("button", { name: "最大化" })).toBeTruthy();
    act(() => notify?.(true));
    expect(screen.getByRole("button", { name: "还原" })).toBeTruthy();
  });
});


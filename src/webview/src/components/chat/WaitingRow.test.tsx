// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaitingRow } from "./WaitingRow";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const t = (key: string) => key;

describe("WaitingRow", () => {
  it("渲染转圈与首条提示", () => {
    render(<WaitingRow t={t} />);
    expect(screen.getByTestId("chat-waiting")).toBeTruthy();
    expect(screen.getByText("chat.waiting.0")).toBeTruthy();
  });

  it("按间隔轮换提示并循环", () => {
    vi.useFakeTimers();
    render(<WaitingRow t={t} />);
    act(() => vi.advanceTimersByTime(3200));
    expect(screen.getByText("chat.waiting.1")).toBeTruthy();
    act(() => vi.advanceTimersByTime(3200 * 3));
    expect(screen.getByText("chat.waiting.0")).toBeTruthy();
  });

  it("卸载后清理定时器", () => {
    vi.useFakeTimers();
    const { unmount } = render(<WaitingRow t={t} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

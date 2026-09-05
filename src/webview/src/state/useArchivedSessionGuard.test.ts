// @vitest-environment jsdom
// useArchivedSessionGuard：活动会话的归档标记一旦为真即调用 leave（每次翻转恰一
// 次）；未命中/落地态不触发；侧栏广播迟到翻转同样触发（侧栏行归档的时序）。
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useArchivedSessionGuard } from "./useArchivedSessionGuard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useArchivedSessionGuard", () => {
  it("活动会话已归档即离开（恰一次）", () => {
    const leave = vi.fn();
    renderHook(() => useArchivedSessionGuard("s1", { s1: true }, leave));
    expect(leave).toHaveBeenCalledExactlyOnceWith();
  });

  it("活动会话未归档不离开", () => {
    const leave = vi.fn();
    renderHook(() => useArchivedSessionGuard("s1", { s2: true }, leave));
    expect(leave).not.toHaveBeenCalled();
  });

  it("落地态（activeId = null）不离开", () => {
    const leave = vi.fn();
    renderHook(() => useArchivedSessionGuard(null, { s1: true }, leave));
    expect(leave).not.toHaveBeenCalled();
  });

  it("归档标记随后翻转（广播迟到）触发离开；恢复（false）不触发", () => {
    const leave = vi.fn();
    const { rerender } = renderHook(
      ({ archived }) => useArchivedSessionGuard("s1", archived, leave),
      { initialProps: { archived: {} as Record<string, boolean> } },
    );
    expect(leave).not.toHaveBeenCalled();
    rerender({ archived: { s1: true } });
    expect(leave).toHaveBeenCalledExactlyOnceWith();
    // 真实链路中 leave 会清空 activeId；此处固定入参模拟恢复翻转，不应再触发。
    rerender({ archived: { s1: false } });
    expect(leave).toHaveBeenCalledExactlyOnceWith();
  });

  it("leave 清空活动会话后（activeId 变 null）不重复调用", () => {
    let activeId: string | null = "s1";
    const leave = vi.fn(() => {
      activeId = null;
    });
    const { rerender } = renderHook(
      ({ id }) => useArchivedSessionGuard(id, { s1: true }, leave),
      { initialProps: { id: activeId as string | null } },
    );
    expect(leave).toHaveBeenCalledExactlyOnceWith();
    rerender({ id: activeId });
    expect(leave).toHaveBeenCalledExactlyOnceWith();
  });
});

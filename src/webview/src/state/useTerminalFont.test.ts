// @vitest-environment jsdom
// useTerminalFont：桥桩件直接挂在 window.innocencecode（lib/ipc 的 api 代理直读
// window）。验证解析结果、失败/桥缺失回落 null、设置变更重取、迟到响应丢弃。
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessSettings, InnocenceCodeApi } from "../../../shared/ipc";
import { useTerminalFont } from "./useTerminalFont";

const getTerminalFont = vi.fn();

function installBridge(): void {
  window.innocencecode = { getTerminalFont } as unknown as InnocenceCodeApi;
}

const settings = (patch: Partial<HarnessSettings> = {}): HarnessSettings => ({
  profiles: [],
  activeProfileId: "",
  activeModel: "",
  workspaceRoot: "",
  permissionMode: "ask",
  ...patch,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as { innocencecode?: unknown }).innocencecode;
});

describe("useTerminalFont", () => {
  it("解析出生效字体即返回（加载中为 null）", async () => {
    installBridge();
    getTerminalFont.mockResolvedValue("Resolved Mono");
    const { result } = renderHook(() => useTerminalFont(settings()));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe("Resolved Mono"));
  });

  it("main 返回 null（无覆盖且未继承）保持 null", async () => {
    installBridge();
    getTerminalFont.mockResolvedValue(null);
    const { result } = renderHook(() => useTerminalFont(settings()));
    await waitFor(() => expect(getTerminalFont).toHaveBeenCalledOnce());
    expect(result.current).toBeNull();
  });

  it("解析失败（reject）回落 null", async () => {
    installBridge();
    getTerminalFont.mockRejectedValue(new Error("ipc down"));
    const { result } = renderHook(() => useTerminalFont(settings()));
    await waitFor(() => expect(getTerminalFont).toHaveBeenCalledOnce());
    expect(result.current).toBeNull();
  });

  it("桥缺失（纯浏览器渲染）不调用且保持 null", () => {
    const { result } = renderHook(() => useTerminalFont(settings()));
    expect(getTerminalFont).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("terminalFontFamily/terminalInheritProfile 变更重取；无关设置不变不重取", async () => {
    installBridge();
    getTerminalFont.mockResolvedValueOnce("Font A").mockResolvedValueOnce("Font B");
    const { result, rerender } = renderHook(({ value }) => useTerminalFont(value), {
      initialProps: { value: settings({ terminalFontFamily: "Font A" }) },
    });
    await waitFor(() => expect(result.current).toBe("Font A"));
    // 无关字段变化（对象换新但两个依赖键不变）不触发重取。
    rerender({ value: settings({ terminalFontFamily: "Font A", activeModel: "m2" }) });
    expect(getTerminalFont).toHaveBeenCalledOnce();
    rerender({ value: settings({ terminalFontFamily: "Font A", terminalInheritProfile: false }) });
    await waitFor(() => expect(result.current).toBe("Font B"));
    expect(getTerminalFont).toHaveBeenCalledTimes(2);
  });

  it("设置变更后迟到的旧响应被丢弃（竞态防护）", async () => {
    installBridge();
    let resolveFirst: (value: string | null) => void = () => {};
    getTerminalFont
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("Font B");
    const { result, rerender } = renderHook(({ value }) => useTerminalFont(value), {
      initialProps: { value: settings({ terminalFontFamily: "Font A" }) },
    });
    await waitFor(() => expect(getTerminalFont).toHaveBeenCalledOnce());
    rerender({ value: settings({ terminalFontFamily: "Font C" }) });
    await waitFor(() => expect(result.current).toBe("Font B"));
    // 第一班次的响应迟到：stale 标记生效，不回写旧值。
    await act(async () => resolveFirst("Font A"));
    expect(result.current).toBe("Font B");
  });
});

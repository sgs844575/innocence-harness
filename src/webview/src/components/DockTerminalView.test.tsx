// @vitest-environment jsdom
// DockTerminalView：jsdom 无布局，xterm 与终端桥全部模块级桩件；验证挂载即
// 建 PTY（终端 id/cwd/初始尺寸）、卸载即释放、桥缺失时静默降级。
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dockCreate: vi.fn(async (req: { terminalId: string }) => ({ terminalId: req.terminalId, ptyId: "pty_1" })),
  dockWrite: vi.fn(async () => {}),
  dockResize: vi.fn(async () => {}),
  dockDispose: vi.fn(async () => {}),
  onDockTerminalOutput: vi.fn(() => () => {}),
  onDockTerminalExit: vi.fn(() => () => {}),
  termDispose: vi.fn(),
  /** 每次 new Terminal 的构造选项（按序），用于断言字体/字号注入。 */
  constructedOptions: [] as Record<string, unknown>[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      mocks.constructedOptions.push(options);
    }
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    onData(): { dispose: () => void } {
      return { dispose() {} };
    }
    dispose(): void {
      mocks.termDispose();
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit(): void {}
    proposeDimensions(): { cols: number; rows: number } {
      return { cols: 80, rows: 24 };
    }
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

const bridgeState = vi.hoisted(() => ({ available: true }));
vi.mock("../lib/terminal", () => ({
  hasTerminalBridge: () => bridgeState.available,
  terminalApi: mocks,
}));

import { DockTerminalView } from "./DockTerminalView";

beforeAll(() => {
  // jsdom 无 ResizeObserver：最小桩。
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.constructedOptions.length = 0;
  bridgeState.available = true;
});

const t = (key: string) => key;

describe("DockTerminalView", () => {
  it("挂载即按 terminalId/cwd/网格尺寸创建 PTY", async () => {
    render(<DockTerminalView t={t} terminalId="term_1" workspaceRoot="D:/proj" visible fontSize={14} />);
    await waitFor(() =>
      expect(mocks.dockCreate).toHaveBeenCalledWith({ terminalId: "term_1", cwd: "D:/proj", cols: 80, rows: 24 }),
    );
  });

  it("卸载（标签关闭）按 terminalId+ptyId 释放并销毁 xterm", async () => {
    const { unmount } = render(<DockTerminalView t={t} terminalId="term_1" workspaceRoot="D:/proj" visible />);
    await waitFor(() => expect(mocks.dockCreate).toHaveBeenCalled());
    unmount();
    expect(mocks.dockDispose).toHaveBeenCalledWith({ terminalId: "term_1", ptyId: "pty_1" });
    expect(mocks.termDispose).toHaveBeenCalled();
  });

  it("桥缺失（纯浏览器渲染）不建 PTY 也不抛错", () => {
    bridgeState.available = false;
    render(<DockTerminalView t={t} terminalId="term_1" workspaceRoot="D:/proj" visible />);
    expect(mocks.dockCreate).not.toHaveBeenCalled();
  });

  it("fontFamily 覆盖：非空值注入 xterm 构造选项", async () => {
    render(<DockTerminalView t={t} terminalId="term_1" workspaceRoot="D:/proj" visible fontFamily="Custom Mono" />);
    await waitFor(() => expect(mocks.constructedOptions.length).toBeGreaterThan(0));
    expect(mocks.constructedOptions.at(-1)?.fontFamily).toBe("Custom Mono");
  });

  it("fontFamily 为 null/缺省：沿用 --font-mono token（jsdom 无该 token → undefined）", async () => {
    render(<DockTerminalView t={t} terminalId="term_1" workspaceRoot="D:/proj" visible fontFamily={null} />);
    await waitFor(() => expect(mocks.constructedOptions.length).toBeGreaterThan(0));
    expect(mocks.constructedOptions.at(-1)?.fontFamily).toBeUndefined();
  });

  it("fontFamily 变更重建终端（旧实例 dispose，与 fontSize 同路径）", async () => {
    const { rerender } = render(
      <DockTerminalView t={t} terminalId="term_1" workspaceRoot="D:/proj" visible fontFamily="Font A" />,
    );
    await waitFor(() => expect(mocks.constructedOptions.at(-1)?.fontFamily).toBe("Font A"));
    rerender(<DockTerminalView t={t} terminalId="term_1" workspaceRoot="D:/proj" visible fontFamily="Font B" />);
    await waitFor(() => expect(mocks.constructedOptions.at(-1)?.fontFamily).toBe("Font B"));
    expect(mocks.constructedOptions).toHaveLength(2);
    expect(mocks.termDispose).toHaveBeenCalledOnce();
  });
});

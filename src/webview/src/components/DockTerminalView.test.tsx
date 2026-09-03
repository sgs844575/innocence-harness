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
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
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
});

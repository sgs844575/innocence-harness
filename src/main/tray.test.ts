// 托盘与关闭到托盘：判定纯函数 + Electron 施加面（Tray 生命周期/close 拦截）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { trayInstances, menuTemplates, appQuit } = vi.hoisted(() => ({
  trayInstances: [] as { image: unknown; destroyed: boolean }[],
  menuTemplates: [] as ({ label?: string; type?: string; click?: () => void })[][],
  appQuit: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getName: () => "TestApp", quit: appQuit, getPath: vi.fn(() => "") },
  BrowserWindow: class {},
  Menu: {
    buildFromTemplate: (template: never[]) => {
      menuTemplates.push(template);
      return { template };
    },
  },
  Tray: class MockTray {
    image: unknown;
    destroyed = false;
    constructor(image: unknown) {
      this.image = image;
      trayInstances.push(this as never);
    }
    setToolTip(): void {}
    setContextMenu(): void {}
    on(): void {}
    destroy(): void {
      this.destroyed = true;
    }
  },
  nativeImage: {
    createFromPath: (p: string) => ({ path: p }),
    createEmpty: () => ({ empty: true }),
  },
  nativeTheme: { shouldUseDarkColors: false },
  protocol: {},
  screen: { getAllDisplays: () => [] },
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { BrowserWindow } from "electron";
import {
  applyCloseToTray,
  disposeTray,
  handleMainWindowClose,
  initTray,
  markTrayQuitting,
  shouldCloseToTray,
  TRAY_LABELS,
} from "./tray";

const realPlatform = process.platform;

function stubPlatform(value: string): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

function fakeWindow() {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
  };
}

beforeEach(() => {
  stubPlatform("win32");
});

afterEach(() => {
  disposeTray();
  stubPlatform(realPlatform);
  trayInstances.length = 0;
  menuTemplates.length = 0;
  vi.clearAllMocks();
});

describe("shouldCloseToTray", () => {
  it("仅 Windows + 已启用 + 非退出三者同时成立", () => {
    expect(shouldCloseToTray({ enabled: true, quitting: false, platform: "win32" })).toBe(true);
    expect(shouldCloseToTray({ enabled: false, quitting: false, platform: "win32" })).toBe(false);
    expect(shouldCloseToTray({ enabled: true, quitting: true, platform: "win32" })).toBe(false);
    expect(shouldCloseToTray({ enabled: true, quitting: false, platform: "darwin" })).toBe(false);
    expect(shouldCloseToTray({ enabled: true, quitting: false, platform: "linux" })).toBe(false);
  });
});

describe("applyCloseToTray", () => {
  it("启用创建托盘（幂等），禁用销毁", () => {
    applyCloseToTray(true);
    applyCloseToTray(true);
    expect(trayInstances).toHaveLength(1);
    expect(menuTemplates).toHaveLength(1);
    const labels = menuTemplates[0]!.map((item) => item.label ?? item.type);
    expect(labels).toEqual([TRAY_LABELS.showWindow, "separator", TRAY_LABELS.quit]);

    applyCloseToTray(false);
    expect(trayInstances[0]!.destroyed).toBe(true);

    applyCloseToTray(true);
    expect(trayInstances).toHaveLength(2);
  });

  it("非 Windows 永不创建托盘", () => {
    stubPlatform("darwin");
    applyCloseToTray(true);
    expect(trayInstances).toHaveLength(0);
  });
});

describe("handleMainWindowClose", () => {
  it("启用时拦截关闭转为隐藏", () => {
    const win = fakeWindow();
    applyCloseToTray(true);
    const event = { preventDefault: vi.fn() };
    expect(handleMainWindowClose(event, win as unknown as BrowserWindow)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  it("未启用/退出标记后不拦截", () => {
    const win = fakeWindow();
    const event = { preventDefault: vi.fn() };
    expect(handleMainWindowClose(event, win as unknown as BrowserWindow)).toBe(false);

    applyCloseToTray(true);
    markTrayQuitting();
    expect(handleMainWindowClose(event, win as unknown as BrowserWindow)).toBe(false);
    expect(trayInstances[0]!.destroyed).toBe(true);
  });
});

describe("tray menu", () => {
  it("显示窗口：还原 + 显示 + 聚焦注入的主窗口", () => {
    const win = fakeWindow();
    initTray({ getWindow: () => win as unknown as BrowserWindow });
    applyCloseToTray(true);
    menuTemplates[0]![0]!.click!();
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  it("退出：先置退出标记再 app.quit", () => {
    applyCloseToTray(true);
    menuTemplates[0]![2]!.click!();
    expect(appQuit).toHaveBeenCalledTimes(1);
    // 退出标记已置位：窗口 close 不再被拦截。
    const win = fakeWindow();
    expect(handleMainWindowClose({ preventDefault: vi.fn() }, win as unknown as BrowserWindow)).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ComputerActivityViewState } from "../shared/computerActivity";
import { COMPUTER_ACTIVITY as channels } from "../shared/computerActivity";

const mocks = vi.hoisted(() => ({ windows: [] as any[], handles: new Map<string, (...args: any[]) => any>() }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeWindow extends EventEmitter {
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler: vi.fn() });
    setBounds = vi.fn();
    setAlwaysOnTop = vi.fn();
    setContentProtection = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    setMenu = vi.fn();
    showInactive = vi.fn();
    loadURL = vi.fn(async () => {});
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit("closed"); }
    constructor(public options: unknown) { super(); mocks.windows.push(this); }
  }
  return {
    BrowserWindow: FakeWindow,
    ipcMain: Object.assign(new EventEmitter(), {
      handle: (name: string, handler: (...args: any[]) => any) => mocks.handles.set(name, handler),
      removeHandler: (name: string) => mocks.handles.delete(name),
    }),
    screen: Object.assign(new EventEmitter(), {
      getCursorScreenPoint: () => ({ x: -500, y: 30 }),
      getDisplayNearestPoint: () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }),
    }),
  };
});
vi.mock("./protocol", () => ({ appIndexUrl: () => "innocenceharness://app/index.html" }));
import { ipcMain, screen } from "electron";
import { createComputerActivityWindow } from "./computerActivityWindow";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  mocks.windows.length = 0;
  expect(mocks.handles.size).toBe(0);
  expect((screen as unknown as EventEmitter).listenerCount("display-removed")).toBe(0);
});
function setup() {
  const state: ComputerActivityViewState = {
    activity: { toolName: "computer_click", status: "running", activeCount: 1, startedAt: 1, canStop: true },
    theme: "dark", locale: "zh-CN",
  };
  const stop = vi.fn(async () => {});
  const surface = createComputerActivityWindow(() => state, stop);
  cleanups.push(surface.dispose);
  return { state, surface, stop };
}

describe("desktop activity window", () => {
  it("waits for the rendered capsule and shows without activation, then destroys idle windows", async () => {
    const { state, surface } = setup();
    const showing = surface.present();
    const win = mocks.windows[0];
    expect(win.options).toMatchObject({ focusable: false, transparent: true, skipTaskbar: true, show: false });
    expect(win.setBounds).toHaveBeenCalledWith({ x: -1158, y: 8, width: 396, height: 96 });
    expect(win.setContentProtection).toHaveBeenCalledWith(true);
    expect(win.showInactive).not.toHaveBeenCalled();
    ipcMain.emit(channels.ready, { sender: win.webContents });
    await showing;
    expect(win.showInactive).toHaveBeenCalledOnce();
    expect(win.loadURL).toHaveBeenCalledWith("innocenceharness://app/index.html#computer-activity");
    state.activity = null;
    await surface.present();
    expect(win.isDestroyed()).toBe(true);
  });
  it("restricts control to the owned renderer and forwards transparent margins", async () => {
    const { surface, stop, state } = setup();
    const showing = surface.present();
    const win = mocks.windows[0];
    const sender = { sender: win.webContents };
    expect(() => mocks.handles.get(channels.get)!({ sender: {} })).toThrow("Activity window required");
    await expect(mocks.handles.get(channels.stop)!({ sender: {} })).rejects.toThrow("Activity window required");
    expect(stop).not.toHaveBeenCalled();
    expect(mocks.handles.get(channels.get)!(sender)).toBe(state);
    ipcMain.emit(channels.ready, sender);
    await showing;
    ipcMain.emit(channels.hover, sender, true);
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true });
    ipcMain.emit(channels.hover, sender, false);
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    await mocks.handles.get(channels.stop)!(sender);
    expect(stop).toHaveBeenCalledOnce();
  });
  it("reuses a surface across calls and releases a pending presentation on shutdown", async () => {
    const { surface } = setup();
    const first = surface.present();
    const second = surface.present();
    expect(mocks.windows).toHaveLength(1);
    surface.dispose();
    await Promise.all([first, second]);
    expect(mocks.windows[0].showInactive).not.toHaveBeenCalled();
    await surface.present();
    expect(mocks.windows).toHaveLength(1);
  });
  it("cleans up renderer failures and can open a fresh surface afterwards", async () => {
    const { surface } = setup();
    const first = surface.present();
    mocks.windows[0].webContents.emit("render-process-gone");
    await first;
    const second = surface.present();
    const win = mocks.windows[1];
    ipcMain.emit(channels.ready, { sender: win.webContents });
    await second;
    expect(win.showInactive).toHaveBeenCalledOnce();
  });
});

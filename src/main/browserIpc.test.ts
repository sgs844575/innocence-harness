import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  fromId: vi.fn(), clear: vi.fn(), enabled: true, target: {},
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (key: string, handler: (...args: any[]) => any) => mocks.handlers.set(key, handler) },
  webContents: { fromId: mocks.fromId },
}));
vi.mock("./browserSession", () => ({
  clearBrowserData: mocks.clear,
  getBrowserSession: () => mocks.target,
  isBrowserEnabled: () => mocks.enabled,
}));
import { registerBrowserIpc } from "./browserIpc";

beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); mocks.enabled = true; });

describe("browser IPC ownership", () => {
  const owner = { mainFrame: {} };
  const ownerEvent = { sender: owner, senderFrame: owner.mainFrame };
  const register = () => registerBrowserIpc(() => owner as never);

  it("only lets the owner main frame request cleanup", async () => {
    register();
    const clear = mocks.handlers.get("browser:clear-data")!;
    expect((await clear({ sender: {}, senderFrame: {} }, "all")).ok).toBe(false);
    expect((await clear({ sender: owner, senderFrame: {} }, "all")).ok).toBe(false);
    expect(mocks.clear).not.toHaveBeenCalled();
    await clear(ownerEvent, "cache");
    expect(mocks.clear).toHaveBeenCalledExactlyOnceWith("cache");
  });

  it("rejects disabled control and guests owned by another surface", async () => {
    register();
    const emulate = mocks.handlers.get("browser:emulate")!;
    mocks.enabled = false;
    expect((await emulate(ownerEvent, { guestId: 1 })).ok).toBe(false);
    expect(mocks.fromId).not.toHaveBeenCalled();
    mocks.enabled = true;
    mocks.fromId.mockReturnValue({ isDestroyed: () => false, hostWebContents: {}, session: mocks.target });
    expect((await emulate(ownerEvent, { guestId: 1 })).ok).toBe(false);
  });

  it("validates dimensions before attaching, then emulates an owned guest", async () => {
    register();
    const emulate = mocks.handlers.get("browser:emulate")!;
    const debuggerPort = { isAttached: () => false, attach: vi.fn(), sendCommand: vi.fn(async () => {}) };
    mocks.fromId.mockReturnValue({ isDestroyed: () => false, hostWebContents: owner, session: mocks.target, debugger: debuggerPort });
    expect((await emulate(ownerEvent, { guestId: 1, width: 20, height: 60 })).ok).toBe(false);
    expect(debuggerPort.attach).not.toHaveBeenCalled();
    expect((await emulate(ownerEvent, { guestId: 1, width: 393, height: 852, mobile: true })).ok).toBe(true);
    expect(debuggerPort.sendCommand).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", {
      width: 393, height: 852, mobile: true, deviceScaleFactor: 0,
    });
  });
});

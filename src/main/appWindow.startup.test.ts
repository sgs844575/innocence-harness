import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTimeline: [] as string[],
  windows: [] as Array<{
    webContents: {
      emit(event: string): void;
      willNavigate?: (event: { preventDefault(): void }, url: string) => void;
      openHandler?: () => { action: string };
    };
  }>,
}));

vi.mock("electron", () => {
  class FakeWebContents {
    private readonly listeners = new Map<string, Array<() => void>>();

    once(event: string, listener: () => void): this {
      mocks.loadTimeline.push(`once:${event}`);
      const listeners = this.listeners.get(event) ?? [];
      this.listeners.set(event, [...listeners, listener]);
      return this;
    }

    on(event: string, listener: (...args: never[]) => void): this {
      mocks.loadTimeline.push(`webContents:on:${event}`);
      const listeners = this.listeners.get(event) ?? [];
      this.listeners.set(event, [...listeners, listener as unknown as () => void]);
      if (event === "will-navigate") {
        const window = mocks.windows.at(-1);
        if (window) window.webContents.willNavigate = listener as unknown as (event: { preventDefault(): void }, url: string) => void;
      }
      return this;
    }

    emit(event: string): void {
      const listeners = this.listeners.get(event) ?? [];
      this.listeners.delete(event);
      for (const listener of listeners) {
        if (typeof listener === "function") listener();
      }
    }

    async loadURL(): Promise<void> {
      mocks.loadTimeline.push("loadURL:start");
      this.emit("did-finish-load");
      mocks.loadTimeline.push("loadURL:complete");
    }

    setWindowOpenHandler(handler: () => { action: string }): void {
      mocks.loadTimeline.push("setWindowOpenHandler");
      const window = mocks.windows.at(-1);
      if (window) window.webContents.openHandler = handler;
    }
  }

  class FakeBrowserWindow {
    readonly webContents = new FakeWebContents();

    constructor() {
      mocks.windows.push(this);
    }

    async loadURL(): Promise<void> {
      await this.webContents.loadURL();
    }

    once(): this {
      return this;
    }

    on(event: string): this {
      mocks.loadTimeline.push(`window:on:${event}`);
      return this;
    }

    isDestroyed(): boolean {
      return false;
    }

    show(): void {
      // No-op for this timing test.
    }
  }

  return {
    app: { getPath: vi.fn(() => "") },
    BrowserWindow: FakeBrowserWindow,
    nativeTheme: { shouldUseDarkColors: false },
  };
});

vi.mock("./theme", () => ({
  getTheme: vi.fn(() => ({ mode: "system", resolved: "light" })),
  titleBarOverlayFor: vi.fn(() => ({ color: "#f7f7f9", symbolColor: "#6b6b76", height: 36 })),
}));

vi.mock("./logger", () => ({ logger: { error: vi.fn() } }));

import { createMainWindow, getMainWindow } from "./appWindow";

type CreateMainWindow = (onRendererReady?: () => void) => Promise<{
  webContents: { emit(event: string): void };
}>;

const createWindow = createMainWindow as unknown as CreateMainWindow;
vi.stubGlobal("MAIN_WINDOW_VITE_DEV_SERVER_URL", undefined);
Object.defineProperty(process, "resourcesPath", { value: process.resourcesPath ?? process.cwd(), configurable: true });

describe("createMainWindow renderer-ready timing", () => {
  it("invokes the startup hook from a listener registered before loadURL completes", async () => {
    mocks.loadTimeline.length = 0;
    mocks.windows.length = 0;
    const rendererReady = vi.fn(() => {
      expect(getMainWindow()).toBe(mocks.windows[0]);
      mocks.loadTimeline.push("rendererReady");
    });

    await createWindow(rendererReady);

    const listenerIndex = mocks.loadTimeline.indexOf("once:did-finish-load");
    const loadStartIndex = mocks.loadTimeline.indexOf("loadURL:start");
    const loadCompleteIndex = mocks.loadTimeline.indexOf("loadURL:complete");
    const navigationGuardIndex = mocks.loadTimeline.indexOf("webContents:on:will-navigate");
    const windowOpenGuardIndex = mocks.loadTimeline.indexOf("setWindowOpenHandler");
    const windowRegistrationIndex = mocks.loadTimeline.indexOf("window:on:closed");
    const callbackIndex = mocks.loadTimeline.indexOf("rendererReady");

    expect(listenerIndex).toBeGreaterThanOrEqual(0);
    expect(listenerIndex).toBeLessThan(loadStartIndex);
    expect(callbackIndex).toBeGreaterThan(loadCompleteIndex);
    expect(callbackIndex).toBeGreaterThan(navigationGuardIndex);
    expect(callbackIndex).toBeGreaterThan(windowOpenGuardIndex);
    expect(callbackIndex).toBeGreaterThan(windowRegistrationIndex);
    expect(rendererReady).toHaveBeenCalledOnce();
  });

  it("creates and registers a normal window without a renderer startup callback", async () => {
    mocks.loadTimeline.length = 0;
    mocks.windows.length = 0;

    const win = await createWindow();

    expect(win).toBe(mocks.windows[0]);
    expect(getMainWindow()).toBe(win);
    expect(mocks.loadTimeline).not.toContain("once:did-finish-load");
    expect(mocks.loadTimeline).toContain("webContents:on:will-navigate");
    expect(mocks.loadTimeline).toContain("setWindowOpenHandler");
  });

  it("rejects navigation away from the app origin and denies new windows", async () => {
    mocks.loadTimeline.length = 0;
    mocks.windows.length = 0;
    const win = await createWindow();
    const fakeWindow = mocks.windows[0];
    expect(fakeWindow).toBeDefined();

    let prevented = false;
    fakeWindow?.webContents.willNavigate?.({ preventDefault: () => { prevented = true; } }, "https://evil.example/");
    expect(prevented).toBe(true);
    expect(fakeWindow?.webContents.openHandler?.()).toEqual({ action: "deny" });
    expect(getMainWindow()).toBe(win);
  });

  it("does not run the renderer startup hook more than once for one window", async () => {
    mocks.loadTimeline.length = 0;
    mocks.windows.length = 0;
    const rendererReady = vi.fn();
    const win = await createWindow(rendererReady);

    win.webContents.emit("did-finish-load");

    expect(rendererReady).toHaveBeenCalledOnce();
  });
});

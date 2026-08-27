import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTimeline: [] as string[],
  windows: [] as Array<{
    webContents: {
      emit(event: string): void;
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

    on(event: string, listener: () => void): this {
      const listeners = this.listeners.get(event) ?? [];
      this.listeners.set(event, [...listeners, listener]);
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

    setWindowOpenHandler(): void {
      // No-op for this timing test.
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

    on(): this {
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

import { createMainWindow } from "./appWindow";

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
      mocks.loadTimeline.push("rendererReady");
    });

    await createWindow(rendererReady);

    expect(mocks.loadTimeline.indexOf("once:did-finish-load")).toBeGreaterThanOrEqual(0);
    expect(mocks.loadTimeline.indexOf("once:did-finish-load")).toBeLessThan(mocks.loadTimeline.indexOf("loadURL:start"));
    expect(mocks.loadTimeline.indexOf("rendererReady")).toBeGreaterThan(mocks.loadTimeline.indexOf("loadURL:complete"));
    expect(rendererReady).toHaveBeenCalledOnce();
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

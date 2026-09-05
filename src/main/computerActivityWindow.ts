import path from "node:path";
import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { COMPUTER_ACTIVITY as channels, type ComputerActivityViewState } from "../shared/computerActivity";
import { appIndexUrl } from "./protocol";

/** Owns only the desktop surface; operation state and cancellation stay outside. */
export function createComputerActivityWindow(getState: () => ComputerActivityViewState, stop: () => Promise<void>) {
  let window: BrowserWindow | undefined;
  let ready: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let disposed = false;

  const owns = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    window && !window.isDestroyed() && event.sender === window.webContents;
  const position = () => {
    if (!window || window.isDestroyed()) return;
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(396, area.width);
    window.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: area.y + 8, width, height: 96 });
  };
  const close = () => {
    const previous = window;
    window = undefined;
    release?.();
    release = undefined;
    ready = undefined;
    if (previous && !previous.isDestroyed()) previous.destroy();
  };
  const onReady = (event: IpcMainEvent) => {
    if (!owns(event)) return;
    window!.showInactive();
    release?.();
    release = undefined;
  };
  const onHover = (event: IpcMainEvent, inside: unknown) => {
    if (owns(event) && typeof inside === "boolean") window!.setIgnoreMouseEvents(!inside, { forward: true });
  };
  ipcMain.handle(channels.get, (event) => {
    if (!owns(event)) throw new Error("Activity window required");
    return getState();
  });
  ipcMain.handle(channels.stop, async (event) => {
    if (!owns(event)) throw new Error("Activity window required");
    await stop();
  });
  ipcMain.on(channels.ready, onReady);
  ipcMain.on(channels.hover, onHover);
  screen.on("display-metrics-changed", position);
  screen.on("display-removed", position);

  return {
    async present() {
      if (disposed) return;
      if (!getState().activity) { close(); return; }
      if (!window || window.isDestroyed()) {
        const created = new BrowserWindow({
          width: 396, height: 96, show: false, frame: false, transparent: true,
          focusable: false, skipTaskbar: true, resizable: false, movable: false,
          minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
          webPreferences: {
            preload: path.join(__dirname, "computerActivityPreload.js"),
            sandbox: true, contextIsolation: true, nodeIntegration: false,
          },
        });
        window = created;
        ready = new Promise<void>((resolve) => { release = resolve; });
        created.setAlwaysOnTop(true, "screen-saver");
        created.setContentProtection(true);
        created.setIgnoreMouseEvents(true, { forward: true });
        created.setMenu(null);
        created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        created.webContents.on("will-navigate", (event) => event.preventDefault());
        created.webContents.on("render-process-gone", () => { if (window === created) close(); });
        created.once("closed", () => { if (window === created) close(); });
        position();
        const url = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL
          ? MAIN_WINDOW_VITE_DEV_SERVER_URL : appIndexUrl();
        try { await created.loadURL(`${url.replace(/#.*$/, "")}#computer-activity`); }
        catch (error) { if (window === created) close(); throw error; }
      }
      if (window && !window.isDestroyed()) window.webContents.send(channels.changed, getState());
      await ready;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      ipcMain.removeHandler(channels.get);
      ipcMain.removeHandler(channels.stop);
      ipcMain.removeListener(channels.ready, onReady);
      ipcMain.removeListener(channels.hover, onHover);
      screen.removeListener("display-metrics-changed", position);
      screen.removeListener("display-removed", position);
    },
  };
}

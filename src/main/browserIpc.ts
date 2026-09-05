import { ipcMain, webContents, type WebContents } from "electron";
import { IPC, type BrowserEmulateRequest } from "../shared/ipc";
import { clearBrowserData, getBrowserSession, isBrowserEnabled } from "./browserSession";

export function registerBrowserIpc(getOwner: () => WebContents | undefined): void {
  ipcMain.handle(IPC.browserClearData, (event, kind) => {
    if (event.sender !== getOwner() || event.senderFrame !== event.sender.mainFrame) {
      return { ok: false, error: "Browser settings are only available to the main window" };
    }
    return clearBrowserData(kind);
  });

  ipcMain.handle(IPC.browserEmulate, async (event, req: BrowserEmulateRequest) => {
    if (!isBrowserEnabled()) return { ok: false, error: "Embedded browser is disabled" };
    if (event.sender !== getOwner() || event.senderFrame !== event.sender.mainFrame) {
      return { ok: false, error: "Invalid browser host" };
    }
    const guestId = Number(req?.guestId);
    if (!Number.isInteger(guestId) || guestId <= 0) return { ok: false, error: "Invalid guestId" };
    const guest = webContents.fromId(guestId);
    if (!guest || guest.isDestroyed()) return { ok: false, error: "Browser guest is gone" };
    if (guest.hostWebContents !== event.sender || guest.session !== getBrowserSession()) {
      return { ok: false, error: "Invalid browser guest" };
    }
    const width = req.width === null ? null : Number(req.width);
    const height = req.height === null ? null : Number(req.height);
    if ((width === null) !== (height === null) || (width !== null && height !== null &&
      (!Number.isInteger(width) || !Number.isInteger(height) || width < 50 || height < 50 || width > 4000 || height > 4000))) {
      return { ok: false, error: "Invalid size" };
    }
    try {
      if (!guest.debugger.isAttached()) guest.debugger.attach("1.3");
      if (width === null || height === null) {
        await guest.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
      } else {
        await guest.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
          width, height, deviceScaleFactor: 0, mobile: req.mobile === true,
        });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
}

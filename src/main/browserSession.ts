import { session, webContents, type Session } from "electron";
import { BROWSER_PARTITION, type BrowserDataKind, type BrowserDataResult } from "../shared/browserIpc";
import { installCustomCaVerify } from "./customCaVerify";

/** Browser storage and certificate policy belong to the dedicated guest partition. */
export function getBrowserSession(): Session {
  return session.fromPartition(BROWSER_PARTITION);
}

export function configureBrowserSession(settings: {
  browserIgnoreCertificateErrors?: boolean;
  customCaCert?: string;
}): void {
  const target = getBrowserSession();
  if (settings.browserIgnoreCertificateErrors === true) {
    target.setCertificateVerifyProc((_request, callback) => callback(0));
  } else {
    target.setCertificateVerifyProc(null);
    if (settings.customCaCert) installCustomCaVerify(target, settings.customCaCert);
  }
}

let browserEnabled = true;

export function isBrowserEnabled(): boolean {
  return browserEnabled;
}

export function applyBrowserEnabled(enabled: boolean): void {
  browserEnabled = enabled;
  if (enabled) return;
  const target = getBrowserSession();
  for (const guest of webContents.getAllWebContents()) {
    if (!guest.isDestroyed() && guest.hostWebContents && guest.session === target) guest.close();
  }
}

let clearing = false;

/** Serialized cleanup avoids racing cache-only and full-data requests. */
export async function clearBrowserData(kind: BrowserDataKind): Promise<BrowserDataResult> {
  if (kind !== "cache" && kind !== "all") return { ok: false, error: "Invalid browser data kind" };
  if (clearing) return { ok: false, error: "Browser data cleanup is already running" };
  clearing = true;
  try {
    const target = getBrowserSession();
    if (kind === "cache") {
      await target.clearData({ dataTypes: ["cache", "serviceWorkers"] });
    } else {
      await target.clearData();
      await target.clearAuthCache();
      await target.closeAllConnections();
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearing = false;
  }
}

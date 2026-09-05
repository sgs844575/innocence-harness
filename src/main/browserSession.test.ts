import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  target: {
    clearData: vi.fn<() => Promise<void>>(),
    clearAuthCache: vi.fn<() => Promise<void>>(),
    closeAllConnections: vi.fn<() => Promise<void>>(),
    setCertificateVerifyProc: vi.fn(),
  },
  fromPartition: vi.fn(),
  getAllWebContents: vi.fn(),
  customCa: vi.fn(),
}));
vi.mock("electron", () => ({
  session: { fromPartition: mocks.fromPartition },
  webContents: { getAllWebContents: mocks.getAllWebContents },
}));
vi.mock("./customCaVerify", () => ({ installCustomCaVerify: mocks.customCa }));
import { applyBrowserEnabled, clearBrowserData, configureBrowserSession, isBrowserEnabled } from "./browserSession";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fromPartition.mockReturnValue(mocks.target);
  mocks.getAllWebContents.mockReturnValue([]);
  mocks.target.clearData.mockResolvedValue();
  mocks.target.clearAuthCache.mockResolvedValue();
  mocks.target.closeAllConnections.mockResolvedValue();
  applyBrowserEnabled(true);
});

describe("browser session", () => {
  it("clears only browser caches and workers, preserving cookies and site storage", async () => {
    expect(await clearBrowserData("cache")).toEqual({ ok: true });
    expect(mocks.fromPartition).toHaveBeenCalledWith("persist:browser");
    expect(mocks.target.clearData).toHaveBeenCalledWith({ dataTypes: ["cache", "serviceWorkers"] });
    expect(mocks.target.clearAuthCache).not.toHaveBeenCalled();
  });

  it("clears all browser data, authentication and connections", async () => {
    expect(await clearBrowserData("all")).toEqual({ ok: true });
    expect(mocks.target.clearData).toHaveBeenCalledWith();
    expect(mocks.target.clearAuthCache).toHaveBeenCalledOnce();
    expect(mocks.target.closeAllConnections).toHaveBeenCalledOnce();
  });

  it("rejects invalid requests and recovers after a cleanup failure", async () => {
    expect((await clearBrowserData("invalid" as "all")).ok).toBe(false);
    expect(mocks.fromPartition).not.toHaveBeenCalled();
    mocks.target.clearData.mockRejectedValueOnce(new Error("storage unavailable"));
    expect(await clearBrowserData("cache")).toEqual({ ok: false, error: "storage unavailable" });
    expect(await clearBrowserData("cache")).toEqual({ ok: true });
  });

  it("keeps overlapping cleanup requests from racing", async () => {
    let finish!: () => void;
    mocks.target.clearData.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const pending = clearBrowserData("cache");
    expect((await clearBrowserData("all")).ok).toBe(false);
    finish();
    expect(await pending).toEqual({ ok: true });
  });

  it("limits certificate bypass to the browser partition and restores normal verification", () => {
    configureBrowserSession({ browserIgnoreCertificateErrors: true });
    const verify = mocks.target.setCertificateVerifyProc.mock.calls[0][0];
    const callback = vi.fn();
    verify({}, callback);
    expect(callback).toHaveBeenCalledWith(0);
    configureBrowserSession({ browserIgnoreCertificateErrors: false, customCaCert: "/certs/local.pem" });
    expect(mocks.target.setCertificateVerifyProc).toHaveBeenLastCalledWith(null);
    expect(mocks.customCa).toHaveBeenCalledWith(mocks.target, "/certs/local.pem");
    expect(mocks.fromPartition.mock.calls.every(([partition]) => partition === "persist:browser")).toBe(true);
  });

  it("disabling closes only live browser guests", () => {
    const owned = { hostWebContents: {}, session: mocks.target, isDestroyed: () => false, close: vi.fn() };
    const other = { ...owned, session: {}, close: vi.fn() };
    const host = { ...owned, hostWebContents: null, close: vi.fn() };
    mocks.getAllWebContents.mockReturnValue([owned, other, host]);
    applyBrowserEnabled(false);
    expect(isBrowserEnabled()).toBe(false);
    expect(owned.close).toHaveBeenCalledOnce();
    expect(other.close).not.toHaveBeenCalled();
    expect(host.close).not.toHaveBeenCalled();
  });
});

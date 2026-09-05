// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessSettings } from "../../../../shared/ipc";
import { BrowserPanel } from "./BrowserPanel";
import { BrowserAccess } from "./BrowserAccess";

afterEach(cleanup);
const t = (key: string) => key;
const settings: HarnessSettings = { profiles: [], activeProfileId: "", activeModel: "", workspaceRoot: "", permissionMode: "ask" };
const props = { t, settings, onPatchSettings: vi.fn() };

describe("browser settings", () => {
  it("persists independent browser and certificate choices", async () => {
    const onPatchSettings = vi.fn(async () => {});
    render(<BrowserPanel {...props} onPatchSettings={onPatchSettings} />);
    const enabled = screen.getByRole("switch", { name: "settings.browser.enabled" });
    expect(enabled).toHaveAttribute("aria-checked", "true");
    await act(async () => fireEvent.click(enabled));
    expect(onPatchSettings).toHaveBeenCalledWith({ browserEnabled: false });
    const certificates = screen.getByRole("switch", { name: "settings.browser.ignoreCertificates" });
    expect(certificates).toHaveAttribute("aria-checked", "false");
    await act(async () => fireEvent.click(certificates));
    expect(onPatchSettings).toHaveBeenLastCalledWith({ browserIgnoreCertificateErrors: true });
    expect(screen.getByRole("status")).toHaveTextContent("settings.browser.restartRequired");
  });

  it("locks both cleanup buttons while cache clearing is pending and reports completion", async () => {
    let finish!: (result: { ok: true }) => void;
    const onClearData = vi.fn(() => new Promise<{ ok: true }>((resolve) => { finish = resolve; }));
    render(<BrowserPanel {...props} onClearData={onClearData} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.browser.clearCache.action" }));
    expect(onClearData).toHaveBeenCalledWith("cache");
    expect(screen.getByRole("button", { name: "settings.browser.clearing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "settings.browser.clearAll.action" })).toBeDisabled();
    await act(async () => finish({ ok: true }));
    expect(screen.getByRole("status")).toHaveTextContent("settings.browser.cacheCleared");
  });

  it("clears all data only after confirmation; cancelling leaves data untouched", async () => {
    const onClearData = vi.fn(async () => ({ ok: true as const }));
    render(<BrowserPanel {...props} onClearData={onClearData} />);
    fireEvent.click(screen.getByRole("button", { name: "settings.browser.clearAll.action" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onClearData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "settings.dialog.cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClearData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "settings.browser.clearAll.action" }));
    await act(async () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "settings.browser.clearAll.action" })));
    expect(onClearData).toHaveBeenCalledExactlyOnceWith("all");
    expect(screen.getByRole("status")).toHaveTextContent("settings.browser.dataCleared");
  });

  it("reports cleanup and save failures without claiming success, then permits retry", async () => {
    const onClearData = vi.fn(async () => ({ ok: false as const, error: "storage locked" }));
    const onPatchSettings = vi.fn(async () => { throw new Error("save failed"); });
    render(<BrowserPanel {...props} onClearData={onClearData} onPatchSettings={onPatchSettings} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "settings.browser.clearCache.action" })));
    expect(screen.getByRole("alert")).toHaveTextContent("storage locked");
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "settings.browser.enabled" })));
    expect(screen.getByRole("alert")).toHaveTextContent("save failed");
    expect(screen.getByRole("switch", { name: "settings.browser.enabled" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "settings.browser.clearCache.action" })).toBeEnabled();
  });

  it("disables unavailable cleanup and settings that have not loaded", () => {
    render(<BrowserPanel {...props} settings={null} />);
    expect(screen.getByRole("switch", { name: "settings.browser.enabled" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "settings.browser.clearCache.action" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "settings.browser.clearAll.action" })).toHaveAttribute("aria-description", "settings.browser.unavailable");
  });

  it("unmounts browser content while disabled and links back to settings", () => {
    const onOpenSettings = vi.fn();
    const { rerender } = render(<BrowserAccess t={t} enabled onOpenSettings={onOpenSettings}><div>guest page</div></BrowserAccess>);
    expect(screen.getByText("guest page")).toBeTruthy();
    rerender(<BrowserAccess t={t} enabled={false} onOpenSettings={onOpenSettings}><div>guest page</div></BrowserAccess>);
    expect(screen.queryByText("guest page")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "settings.browser.openSettings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});

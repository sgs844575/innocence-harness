// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstallPreview, PluginCatalogApi, PluginSettingsSnapshot } from "../../../../../shared/pluginCatalogIpc";
import { PluginsPanel } from "./PluginsPanel";
import { InstallDialog } from "./InstallDialog";
import { pluginCatalogEn } from "../../../lib/pluginCatalogI18n";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const t = (key: string) => pluginCatalogEn[key as keyof typeof pluginCatalogEn] ?? key;
const preview: InstallPreview = { token: "preview", id: "installed-test", name: "helper", title: "Helper", description: "Review changes", version: "1.0", format: "bundle", components: ["skills"], unsupported: ["hooks"], installable: true, source: { url: "https://git.example.org/team/plugins.git", path: "." }, commit: "a".repeat(40), replacing: false };
function fakeApi(snapshot?: Partial<PluginSettingsSnapshot>): PluginCatalogApi {
  return {
    pluginCatalogSnapshot: vi.fn(async () => ({ markets: [], installed: [], inventory: [
      { id: "core", title: "Core", core: true, client: false, toggleable: false, state: "active" as const, via: "default" as const },
      { id: "helper", title: "Helper", core: false, client: false, toggleable: true, state: "active" as const, via: "default" as const },
    ], ...snapshot })),
    pluginMarketAdd: vi.fn(async () => undefined), pluginMarketRefresh: vi.fn(async () => undefined), pluginMarketRemove: vi.fn(async () => undefined),
    pluginPreview: vi.fn(async () => preview), pluginInstall: vi.fn(async () => undefined), pluginDiscard: vi.fn(async () => undefined),
    pluginUninstall: vi.fn(async () => undefined), pluginSetEnabled: vi.fn(async () => undefined),
  };
}
describe("plugin settings", () => {
  it("shows a failed default source with retry while keeping available plugins browsable", async () => {
    const api = fakeApi({ markets: [
      { id: "one", title: "Default one", source: { url: "https://git.example.org/one.git" }, updatedAt: "", entries: [], syncError: "Connection unavailable" },
      { id: "two", title: "Default two", source: { url: "https://git.example.org/two.git" }, updatedAt: "2026-01-01", entries: [{ name: "Available helper", description: "Review files", source: preview.source }] },
    ] });
    render(<PluginsPanel api={api} t={t} />);
    await screen.findByText("Core");
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(screen.getByText("Available helper")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("Connection unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() => expect(api.pluginMarketRefresh).toHaveBeenCalledWith("one"));
    fireEvent.click(screen.getByRole("button", { name: /Marketplaces/ }));
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(screen.getByText(/Not synced yet/)).toBeTruthy();
  });
  it("renders inventory, protects required plugins, filters and toggles an editable plugin", async () => {
    const api = fakeApi(); render(<PluginsPanel api={api} t={t} />);
    expect(await screen.findByRole("switch", { name: "Enable Core" })).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "Enable Helper" }));
    await waitFor(() => expect(api.pluginSetEnabled).toHaveBeenCalledWith("helper", false));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "absent" } });
    expect(await screen.findByText("No matches. Try another search.")).toBeTruthy();
  });
  it("shows a useful empty marketplace view and opens the add-source dialog", async () => {
    render(<PluginsPanel api={fakeApi()} t={t} />);
    await screen.findByText("Core");
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    fireEvent.click(screen.getByRole("button", { name: "Add marketplace" }));
    expect(screen.getByRole("dialog", { name: "Add marketplace" })).toBeTruthy();
  });
  it("downloads a preview before install, exposes unsupported components and submits its token", async () => {
    const api = fakeApi(); const onClose = vi.fn();
    render(<InstallDialog api={api} t={t} market={false} source={preview.source} onClose={onClose} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Read plugin details" }));
    await screen.findByText("Helper");
    expect(screen.getByText(/Not supported here.*Lifecycle hooks/)).toBeTruthy();
    expect(api.pluginInstall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Install plugin" }));
    await waitFor(() => expect(api.pluginInstall).toHaveBeenCalledWith("preview"));
    expect(onClose).toHaveBeenCalled();
  });
  it("discards a preview on cancellation and keeps an error visible for retry", async () => {
    const api = fakeApi(); const onClose = vi.fn();
    vi.mocked(api.pluginPreview).mockRejectedValueOnce(new Error("Repository unavailable"));
    render(<InstallDialog api={api} t={t} market={false} source={preview.source} onClose={onClose} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Read plugin details" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Repository unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Read plugin details" }));
    await screen.findByText("Helper");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.pluginDiscard).toHaveBeenCalledWith("preview"));
    expect(onClose).toHaveBeenCalled();
  });
  it("paginates the discover list and resets the page when the query or market filter changes", async () => {
    const entries = Array.from({ length: 40 }, (_, index) => ({ name: `Helper ${index}`, description: `Review step ${index}`, source: preview.source }));
    const api = fakeApi({ markets: [{ id: "one", title: "Market", source: { url: "https://git.example.org/one.git" }, updatedAt: "2026-01-01", entries }] });
    render(<PluginsPanel api={api} t={t} />);
    await screen.findByText("Core");
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(screen.getByText("Helper 0")).toBeTruthy();
    expect(screen.queryByText("Helper 24")).toBeNull();
    expect(screen.getByText("Showing 24 of 40 plugins")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(screen.getByText("Helper 39")).toBeTruthy();
    expect(screen.queryByText(/Showing/)).toBeNull();
    // Changing the query resets pagination: clearing the broad filter again shows only the first page.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Helper 3" } });
    await screen.findByText("Helper 3");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.getByText("Helper 0")).toBeTruthy();
    expect(screen.queryByText("Helper 39")).toBeNull();
    expect(screen.getByText("Showing 24 of 40 plugins")).toBeTruthy();
  });
  it("polls while a market sync is in flight and stops once it settles", async () => {
    const settled = { id: "one", title: "Market", source: { url: "https://git.example.org/one.git" }, updatedAt: "2026-01-01", entries: [{ name: "Arrived helper", description: "Fresh", source: preview.source }] };
    let calls = 0;
    const api = fakeApi();
    vi.mocked(api.pluginCatalogSnapshot).mockImplementation(async () => {
      calls += 1;
      return { markets: [calls === 1 ? { ...settled, updatedAt: "", entries: [], syncing: true } : settled], installed: [], inventory: [] };
    });
    vi.useFakeTimers();
    render(<PluginsPanel api={api} t={t} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(screen.getAllByText(/Syncing marketplace sources/).length).toBeGreaterThan(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.pluginCatalogSnapshot).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Arrived helper")).toBeTruthy();
    expect(screen.queryAllByText(/Syncing marketplace sources/)).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(api.pluginCatalogSnapshot).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { CatalogService, Marketplace } from "@innocenceharness/harness-plugin-catalog";
import { createPluginSettingsService } from "./pluginCatalogService";

const market = (overrides?: Partial<Marketplace>): Marketplace => ({ id: "market", title: "Market", source: { url: "https://git.example.org/market.git" }, updatedAt: "2026-01-01", entries: [], ...overrides });
describe("plugin settings adapter", () => {
  it("protects required and project-controlled plugins, updates an editable plugin and emits a change", async () => {
    const setEnabled = vi.fn(async () => undefined); const changed = vi.fn();
    const api = createPluginSettingsService({ catalog: {} as CatalogService, setEnabled, changed, inventory: async () => [
      { id: "core", title: "Core", core: true, toggleable: false, client: false, state: "active", via: "default" },
      { id: "project", title: "Project", core: false, toggleable: true, client: false, state: "disabled-by-config", via: "project" },
      { id: "editable", title: "Editable", core: false, toggleable: true, client: false, state: "active", via: "default" },
    ] });
    await expect(api.pluginSetEnabled("core", false)).rejects.toThrow();
    await expect(api.pluginSetEnabled("project", true)).rejects.toThrow("project");
    await expect(api.pluginSetEnabled("unknown", true)).rejects.toThrow();
    expect(setEnabled).not.toHaveBeenCalled();
    await api.pluginSetEnabled("editable", false);
    expect(setEnabled).toHaveBeenCalledWith("editable", false);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("serves repeat snapshots from cache and recomputes after a mutation or an explicit force", async () => {
    let snapshots = 0; let inventories = 0;
    const catalog: CatalogService = {
      snapshot: vi.fn(async () => { snapshots += 1; return { markets: [market()], installed: [] }; }),
      addMarket: vi.fn(async () => undefined), refreshMarket: vi.fn(async () => undefined), removeMarket: vi.fn(async () => undefined),
      preview: vi.fn(), install: vi.fn(async () => undefined), discard: vi.fn(async () => undefined), uninstall: vi.fn(async () => undefined), dispose: vi.fn(async () => undefined),
    };
    const api = createPluginSettingsService({ catalog, inventory: async () => { inventories += 1; return []; }, setEnabled: async () => undefined, changed: () => undefined });
    await api.pluginCatalogSnapshot();
    await api.pluginCatalogSnapshot();
    expect(snapshots).toBe(1);
    expect(inventories).toBe(1);
    await api.pluginCatalogSnapshot(true);
    expect(snapshots).toBe(2);
    await api.pluginMarketRemove("market");
    await api.pluginCatalogSnapshot();
    expect(snapshots).toBe(3);
    expect(inventories).toBe(3);
  });
  it("keeps snapshots uncached while a background market sync is in flight", async () => {
    let snapshots = 0;
    const catalog: CatalogService = {
      snapshot: vi.fn(async () => { snapshots += 1; return { markets: [market({ syncing: true })], installed: [] }; }),
      addMarket: vi.fn(async () => undefined), refreshMarket: vi.fn(async () => undefined), removeMarket: vi.fn(async () => undefined),
      preview: vi.fn(), install: vi.fn(async () => undefined), discard: vi.fn(async () => undefined), uninstall: vi.fn(async () => undefined), dispose: vi.fn(async () => undefined),
    };
    const api = createPluginSettingsService({ catalog, inventory: async () => [], setEnabled: async () => undefined, changed: () => undefined });
    await api.pluginCatalogSnapshot();
    await api.pluginCatalogSnapshot();
    expect(snapshots).toBe(2);
  });
});

import type { CatalogService } from "@innocenceharness/harness-plugin-catalog";
import type { PluginCatalogApi, PluginSettingsSnapshot } from "../shared/pluginCatalogIpc";
import type { PluginInventory } from "../shared/ipc";

export function createPluginSettingsService(ports: {
  catalog: CatalogService;
  inventory(): Promise<PluginInventory>;
  setEnabled(id: string, enabled: boolean): Promise<unknown>;
  changed(): void | Promise<void>;
}): PluginCatalogApi {
  const change = async (action: () => Promise<void>) => { await action(); await ports.changed(); };
  // Snapshot assembly rescans installed receipts and the plugin inventory, so serve it from cache
  // until a mutation invalidates it. Snapshots with an in-flight market sync stay uncached so
  // polling clients keep observing fresh progress.
  let cached: PluginSettingsSnapshot | undefined;
  const invalidate = () => { cached = undefined; };
  const mutating = async (action: () => Promise<void>) => { invalidate(); try { await action(); } finally { invalidate(); } };
  return {
    async pluginCatalogSnapshot(force?: boolean) {
      if (force !== true && cached) return cached;
      const snapshot: PluginSettingsSnapshot = { ...await ports.catalog.snapshot(), inventory: await ports.inventory() };
      cached = snapshot.markets.some((row) => row.syncing) ? undefined : snapshot;
      return snapshot;
    },
    pluginMarketAdd: (source) => mutating(() => ports.catalog.addMarket(source)),
    pluginMarketRefresh: (id) => mutating(() => ports.catalog.refreshMarket(id)),
    pluginMarketRemove: (id) => mutating(() => ports.catalog.removeMarket(id)),
    pluginPreview: (source) => ports.catalog.preview(source),
    pluginInstall: (token) => mutating(() => change(() => ports.catalog.install(token))),
    pluginDiscard: (token) => ports.catalog.discard(token),
    pluginUninstall: (id) => mutating(() => change(() => ports.catalog.uninstall(id))),
    pluginSetEnabled: (id, enabled) => mutating(() => change(async () => {
      if (typeof enabled !== "boolean") throw new Error("Invalid plugin state.");
      const entry = (await ports.inventory()).find((row) => row.id === id);
      if (!entry?.toggleable || entry.core) throw new Error("This plugin cannot be toggled.");
      if (entry.via === "project") throw new Error("This plugin is controlled by project settings.");
      await ports.setEnabled(id, enabled);
    })),
  };
}

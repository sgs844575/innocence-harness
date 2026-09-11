import type { CatalogSnapshot, InstallPreview, RepositorySource } from "@innocenceharness/harness-plugin-catalog";
import type { PluginInventory } from "./ipc";
export type { CatalogEntry, InstalledPlugin, InstallPreview, Marketplace, RepositorySource } from "@innocenceharness/harness-plugin-catalog";
export interface PluginSettingsSnapshot extends CatalogSnapshot { inventory: PluginInventory }
export const PluginCatalogChannels = {
  pluginCatalogSnapshot: "plugin-catalog:snapshot",
  pluginMarketAdd: "plugin-catalog:market-add",
  pluginMarketRefresh: "plugin-catalog:market-refresh",
  pluginMarketRemove: "plugin-catalog:market-remove",
  pluginPreview: "plugin-catalog:preview",
  pluginInstall: "plugin-catalog:install",
  pluginDiscard: "plugin-catalog:discard",
  pluginUninstall: "plugin-catalog:uninstall",
  pluginSetEnabled: "plugin-catalog:set-enabled",
} as const;
export interface PluginCatalogApi {
  pluginCatalogSnapshot(force?: boolean): Promise<PluginSettingsSnapshot>;
  pluginMarketAdd(source: RepositorySource): Promise<void>;
  pluginMarketRefresh(id: string): Promise<void>;
  pluginMarketRemove(id: string): Promise<void>;
  pluginPreview(source: RepositorySource): Promise<InstallPreview>;
  pluginInstall(token: string): Promise<void>;
  pluginDiscard(token: string): Promise<void>;
  pluginUninstall(id: string): Promise<void>;
  pluginSetEnabled(id: string, enabled: boolean): Promise<void>;
}

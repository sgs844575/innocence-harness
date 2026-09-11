import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { createCatalogService, type CatalogService } from "@innocenceharness/harness-plugin-catalog";
import { PluginCatalogChannels } from "../shared/pluginCatalogIpc";
import { IPC } from "../shared/ipc";
import { appDataRoot } from "./appDataRoot";
import { defaultUserPluginRoot } from "./pluginBoot/compose";
import { getPluginInventory, setHarnessSettings, disposeLspRuntime } from "./harnessGlue";
import { createPluginSettingsService } from "./pluginCatalogService";
import { currentTestOverrides } from "./testOverrides";
import { defaultPluginMarkets } from "./defaultPluginMarkets";

let catalog: CatalogService | undefined;
export function registerPluginCatalogIpc(): void {
  catalog = createCatalogService({ defaultMarkets: defaultPluginMarkets, getStateRoot: () => path.join(appDataRoot(), "plugin-catalog"), getPluginRoot: () => currentTestOverrides(app.isPackaged).userPluginRoot ?? defaultUserPluginRoot() });
  const api = createPluginSettingsService({
    catalog, inventory: getPluginInventory,
    setEnabled: (id, enabled) => setHarnessSettings({ pluginToggleChanges: { [id]: enabled } }),
    changed: async () => { await disposeLspRuntime(); for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.pluginsChanged); },
  });
  for (const [method, channel] of Object.entries(PluginCatalogChannels)) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => Reflect.apply(api[method as keyof typeof api], api, args));
  }
}
export async function disposePluginCatalog(): Promise<void> { await catalog?.dispose(); catalog = undefined; }

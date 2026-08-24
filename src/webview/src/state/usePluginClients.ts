import { useCallback, useEffect, useState } from "react";
import type { PluginInventory } from "../../../shared/ipc";
import { api } from "../lib/ipc";
import { importSchemeModule, loadPluginClients } from "../pluginClient/loader";
import type { SlotRegistry } from "../slots/registry";

export interface PluginClientsState {
  pluginInventory: PluginInventory | null;
  pluginInventoryError: boolean;
  refreshPluginInventory(): void;
}

/** App-level plugin inventory refresh and client-module loading lifecycle. */
export function usePluginClients(registry: SlotRegistry): PluginClientsState {
  const [pluginInventory, setPluginInventory] = useState<PluginInventory | null>(null);
  const [pluginInventoryError, setPluginInventoryError] = useState(false);

  const refreshPluginInventory = useCallback(() => {
    void (async () => {
      try {
        const inventory = await api.getPluginInventory();
        setPluginInventory(inventory);
        setPluginInventoryError(false);
        await loadPluginClients({ inventory, registry, importModule: importSchemeModule });
      } catch {
        setPluginInventory([]);
        setPluginInventoryError(true);
      }
    })();
  }, [registry]);

  useEffect(() => {
    refreshPluginInventory();
    return api.onPluginsChanged(refreshPluginInventory);
  }, [refreshPluginInventory]);

  return { pluginInventory, pluginInventoryError, refreshPluginInventory };
}

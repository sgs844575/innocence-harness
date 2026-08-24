import { useCallback, useEffect, useRef, useState } from "react";
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
  const hmrRevision = useRef(0);

  const refreshPluginInventoryWithRevision = useCallback((revision?: number) => {
    void (async () => {
      try {
        const inventory = await api.getPluginInventory();
        setPluginInventory(inventory);
        setPluginInventoryError(false);
        await loadPluginClients({ inventory, registry, importModule: importSchemeModule, revision });
      } catch {
        setPluginInventory([]);
        setPluginInventoryError(true);
      }
    })();
  }, [registry]);

  const refreshPluginInventory = useCallback(() => {
    refreshPluginInventoryWithRevision();
  }, [refreshPluginInventoryWithRevision]);

  useEffect(() => {
    refreshPluginInventory();
    return api.onPluginsChanged(() => {
      const revision = ++hmrRevision.current;
      refreshPluginInventoryWithRevision(revision);
    });
  }, [refreshPluginInventory, refreshPluginInventoryWithRevision]);

  return { pluginInventory, pluginInventoryError, refreshPluginInventory };
}

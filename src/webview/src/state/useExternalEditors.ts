import { useEffect, useSyncExternalStore } from "react";
import type { EditorCatalog, EditorIpcApi } from "../../../shared/editorIpc";

interface Snapshot { catalog?: EditorCatalog; loading: boolean; selecting: boolean; error?: string }
function createStore(api?: EditorIpcApi) {
  let snapshot: Snapshot = { loading: !!api, selecting: false };
  const listeners = new Set<() => void>();
  let pending: Promise<void> | undefined;
  let refreshedAt = 0;
  const update = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((listener) => listener()); };
  const refresh = (force = false): Promise<void> => {
    if (!api || snapshot.selecting) return Promise.resolve();
    if (pending) return pending;
    if (force && snapshot.catalog && Date.now() - refreshedAt < 30_000) return Promise.resolve();
    update({ loading: true, error: undefined });
    pending = api.editorsList(force).then((catalog) => { refreshedAt = Date.now(); update({ catalog }); }).catch((error) => {
      update({ error: error instanceof Error ? error.message : String(error) });
    }).finally(() => { pending = undefined; update({ loading: false }); });
    return pending;
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    refresh,
    async select(id: string) {
      if (!api || snapshot.selecting) return;
      update({ selecting: true, error: undefined });
      try {
        // An in-flight inventory must settle before a selection can replace its snapshot.
        await pending;
        update({ catalog: await api.editorsSelect(id) });
      } catch (error) {
        update({ error: error instanceof Error ? error.message : String(error) });
        throw error;
      } finally { update({ selecting: false }); }
    },
  };
}

const stores = new WeakMap<EditorIpcApi, ReturnType<typeof createStore>>();
const unavailable = createStore();
function storeFor(api?: EditorIpcApi) {
  if (!api) return unavailable;
  let store = stores.get(api);
  if (!store) { store = createStore(api); stores.set(api, store); }
  return store;
}

export function useExternalEditors(api?: EditorIpcApi) {
  const store = storeFor(api);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => { if (!store.getSnapshot().catalog) void store.refresh(); }, [store]);
  return { ...snapshot, refresh: store.refresh, select: store.select };
}

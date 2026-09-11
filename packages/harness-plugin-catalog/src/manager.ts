import { cp, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson, exists, json, record, safePath, validateTree, within } from "./files";
import { gitPort, normalizeSource, type GitPort } from "./git";
import { inspectPlugin } from "./metadata";
import { readMarketplace } from "./marketplace";
import { createMarketStore, sourceIdentity as identity, type DefaultMarketplace } from "./marketStore";
import type { CatalogService, InstalledPlugin, InstallPreview, Marketplace, RepositorySource } from "./protocol";

const receipt = ".installation.json";
interface Prepared { preview: InstallPreview; temp: string; root: string; pluginsRoot: string }
export function createCatalogService(ports: { getStateRoot(): string; getPluginRoot(): string; git?: GitPort; defaultMarkets?: readonly DefaultMarketplace[] }): CatalogService {
  const previews = new Map<string, Prepared>();
  const abort = new AbortController();
  const activeSyncs = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const next = queue.then(() => { if (disposed) throw new Error("Plugin service is closed."); return action(); });
    queue = next.catch(() => undefined); return next;
  };
  const stateFile = () => path.join(ports.getStateRoot(), "marketplaces.json");
  const marketStore = createMarketStore(stateFile, ports.defaultMarkets ?? []);
  const markets = marketStore.read;
  const acquire = async (input: RepositorySource) => {
    const source = normalizeSource(input);
    const staging = path.join(ports.getStateRoot(), "staging");
    await mkdir(staging, { recursive: true });
    const temp = await mkdtemp(path.join(staging, "fetch-"));
    try {
      const checkout = path.join(temp, "repo");
      const commit = await (ports.git ?? gitPort).checkout(source, checkout, abort.signal);
      const root = await safePath(checkout, source.path ?? ".");
      await validateTree(root);
      return { temp, root, source, commit };
    } catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
  };
  const fetchMarket = async (input: RepositorySource): Promise<Marketplace> => {
    const fetched = await acquire(input);
    try {
      const catalog = await readMarketplace(fetched.root, fetched.source);
      const title = ports.defaultMarkets?.find((entry) => identity(normalizeSource(entry.source)) === identity(fetched.source))?.title ?? catalog.title;
      return { id: identity(fetched.source), source: fetched.source, updatedAt: new Date().toISOString(), ...catalog, title };
    }
    finally { await rm(fetched.temp, { recursive: true, force: true }); }
  };
  const installed = async (): Promise<InstalledPlugin[]> => {
    const root = ports.getPluginRoot();
    if (!await exists(root)) return [];
    const result: InstalledPlugin[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^installed-[a-f0-9]{16}$/.test(entry.name)) continue;
      const row = record(await json(path.join(root, entry.name, receipt)));
      if (row.id === entry.name && typeof row.commit === "string") {
        try { result.push({ ...row, ...await inspectPlugin(path.join(root, entry.name)) } as unknown as InstalledPlugin); }
        catch (error) { result.push({ ...row, components: [], installable: false, unsupported: [`Invalid installation: ${error instanceof Error ? error.message : String(error)}`] } as unknown as InstalledPlugin); }
      }
    }
    return result;
  };
  // Market syncs run on the serial queue after the scheduling snapshot returns, so first opens stay responsive.
  const scheduleSync = (base: Marketplace): void => {
    activeSyncs.add(base.id);
    void serial(async () => {
      let next: Marketplace;
      try { next = await fetchMarket(base.source); }
      catch (error) {
        if (abort.signal.aborted) { activeSyncs.delete(base.id); return; }
        next = { ...base, syncError: error instanceof Error ? error.message : String(error) };
      }
      activeSyncs.delete(base.id);
      await marketStore.write((await markets()).map((row) => row.id === base.id ? next : row));
    }).catch(() => undefined);
  };
  return {
    snapshot: () => serial(async () => {
      const all = await markets();
      let changed = false;
      for (let index = 0; index < all.length; index++) {
        const row = all[index];
        // A persisted syncing flag without a live task is debris from a previous run; resync it.
        if (row.updatedAt || row.syncError || (row.syncing && activeSyncs.has(row.id))) continue;
        const base: Marketplace = { ...row, syncing: undefined };
        all[index] = { ...base, syncing: true };
        scheduleSync(base);
        changed = true;
      }
      if (changed) await marketStore.write(all);
      return { markets: all, installed: await installed() };
    }),
    addMarket: (source) => serial(async () => {
      const row = await fetchMarket(source);
      const all = await markets();
      await marketStore.write([...all.filter((item) => item.id !== row.id), row]);
    }),
    refreshMarket: (id) => serial(async () => {
      const all = await markets();
      const previous = all.find((row) => row.id === id);
      if (!previous) throw new Error("Unknown marketplace.");
      const next = await fetchMarket(previous.source);
      await marketStore.write(all.map((row) => row.id === id ? next : row));
    }),
    removeMarket: (id) => serial(async () => { await marketStore.write((await markets()).filter((row) => row.id !== id)); }),
    preview: (source) => serial(async () => {
      // One install dialog owns one preview. Replacing it releases its downloaded tree.
      for (const item of previews.values()) await rm(item.temp, { recursive: true, force: true });
      previews.clear();
      const fetched = await acquire(source);
      try {
        const metadata = await inspectPlugin(fetched.root);
        const id = `installed-${identity(fetched.source)}`;
        const preview: InstallPreview = { ...metadata, id, token: randomUUID(), source: fetched.source, commit: fetched.commit, replacing: (await installed()).some((row) => row.id === id) };
        previews.set(preview.token, { preview, temp: fetched.temp, root: fetched.root, pluginsRoot: ports.getPluginRoot() });
        return preview;
      } catch (error) { await rm(fetched.temp, { recursive: true, force: true }); throw error; }
    }),
    install: (token) => serial(async () => {
      const item = previews.get(token);
      if (!item) throw new Error("Install preview expired. Preview the repository again.");
      if (!item.preview.installable) throw new Error("This plugin has no supported executable components.");
      if (item.pluginsRoot !== ports.getPluginRoot()) throw new Error("Plugin root changed. Preview the repository again.");
      const root = item.pluginsRoot;
      await mkdir(root, { recursive: true });
      const target = within(root, item.preview.id);
      if (await exists(target)) {
        await safePath(root, item.preview.id);
        const previous = record(await json(path.join(target, receipt)));
        if (previous.id !== item.preview.id) throw new Error("Refusing to overwrite an unmanaged plugin.");
      }
      const stage = await mkdtemp(path.join(root, ".install-"));
      const payload = path.join(stage, "payload");
      const backup = path.join(stage, "backup");
      let backedUp = false;
      let preserveBackup = false;
      try {
        await cp(item.root, payload, { recursive: true, filter: (file) => path.basename(file) !== ".git" });
        const { token: _token, replacing: _replacing, ...metadata } = item.preview;
        await atomicJson(path.join(payload, receipt), { ...metadata, installedAt: new Date().toISOString() });
        if (await exists(target)) { await rename(target, backup); backedUp = true; }
        try { await rename(payload, target); }
        catch (error) {
          if (backedUp) {
            try { await rename(backup, target); }
            catch { preserveBackup = true; throw new Error(`Update failed. The previous installation is preserved at ${backup}.`); }
          }
          throw error;
        }
      } finally { if (!preserveBackup) await rm(stage, { recursive: true, force: true }); }
      previews.delete(token);
      await rm(item.temp, { recursive: true, force: true });
    }),
    discard: (token) => serial(async () => {
      const item = previews.get(token);
      if (item) { await rm(item.temp, { recursive: true, force: true }); previews.delete(token); }
    }),
    uninstall: (id) => serial(async () => {
      if (!(await installed()).some((row) => row.id === id)) throw new Error("Only managed plugins can be uninstalled.");
      const target = await safePath(ports.getPluginRoot(), id);
      await rm(target, { recursive: true });
    }),
    async dispose() {
      disposed = true; abort.abort(); await queue;
      for (const item of previews.values()) await rm(item.temp, { recursive: true, force: true });
      previews.clear();
    },
  };
}

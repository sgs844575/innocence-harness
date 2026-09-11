import { createHash } from "node:crypto";
import { atomicJson, json, record } from "./files";
import { normalizeSource } from "./git";
import type { Marketplace, RepositorySource } from "./protocol";

export interface DefaultMarketplace { title: string; source: RepositorySource }
export const sourceIdentity = (source: RepositorySource) => createHash("sha256").update(`${source.url}\n${source.path}`).digest("hex").slice(0, 16);
interface MarketState { markets: Marketplace[]; seededDefaults: string[] }
const repositoryKey = (source: RepositorySource) => {
  const normalized = normalizeSource(source);
  return `${normalized.url.replace(/\.git$/, "")}\n${normalized.path}`;
};

/** Default provenance is persisted alongside rows so a removed source stays removed. */
export function createMarketStore(file: () => string, defaults: readonly DefaultMarketplace[]) {
  async function readState(): Promise<MarketState> {
    const raw = await json(file());
    if (raw === undefined) return { markets: [], seededDefaults: [] };
    if (Array.isArray(raw)) return { markets: raw as Marketplace[], seededDefaults: [] };
    const state = record(raw);
    if (!Array.isArray(state.markets) || !Array.isArray(state.seededDefaults) || !state.seededDefaults.every((id) => typeof id === "string")) throw new Error("Marketplace settings are malformed.");
    return state as unknown as MarketState;
  }
  return {
    async read(): Promise<Marketplace[]> {
      const state = await readState();
      let changed = false;
      for (const entry of defaults) {
        const source = normalizeSource(entry.source);
        const id = sourceIdentity(source);
        if (state.seededDefaults.includes(id)) continue;
        if (!state.markets.some((market) => market.id === id || repositoryKey(market.source) === repositoryKey(source))) state.markets.push({ id, title: entry.title, source, updatedAt: "", entries: [] });
        state.seededDefaults.push(id);
        changed = true;
      }
      if (changed) await atomicJson(file(), state);
      return state.markets;
    },
    async write(markets: Marketplace[]) {
      const state = await readState();
      await atomicJson(file(), { ...state, markets });
    },
  };
}

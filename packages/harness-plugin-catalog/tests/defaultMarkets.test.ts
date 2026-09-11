import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCatalogService, normalizeSource, type CatalogService, type GitPort } from "../src/index";
import { sourceIdentity } from "../src/marketStore";
let root: string;
let service: CatalogService;
let failed = false;
let calls: string[];
const defaults = ["first", "second"].map((name) => ({ title: `Default ${name}`, source: { url: `https://git.example.org/${name}.git` } }));
const ports = () => ({ getStateRoot: () => path.join(root, "state"), getPluginRoot: () => path.join(root, "plugins"), defaultMarkets: defaults,
  git: { async checkout(source, destination) {
    calls.push(source.url);
    if (failed && source.url === defaults[0].source.url) throw new Error("Connection unavailable");
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, "marketplace.json"), JSON.stringify({ name: "upstream-title", plugins: [{ name: "sample", source: "./sample" }] }), "utf8");
    return "a".repeat(40);
  } } satisfies GitPort });
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "default-markets-")); calls = []; failed = false; service = createCatalogService(ports()); });
afterEach(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }); });
it("seeds and synchronizes defaults once, caches results and preserves removal across restarts", async () => {
  const first = await service.snapshot();
  expect(first.markets.map((market) => market.title)).toEqual(["Default first", "Default second"]);
  expect(first.markets.every((market) => market.syncing && !market.entries.length)).toBe(true);
  // A second snapshot queues behind the background syncs and observes the settled state.
  const second = await service.snapshot();
  expect(second.markets.every((market) => market.entries.length === 1 && market.updatedAt)).toBe(true);
  await service.snapshot();
  expect(calls).toHaveLength(2);
  await service.removeMarket(second.markets[0].id);
  await service.dispose(); service = createCatalogService(ports());
  expect((await service.snapshot()).markets.map((market) => market.title)).toEqual(["Default second"]);
  expect(calls).toHaveLength(2);
});
it("migrates existing arrays without duplicating a default or dropping custom sources", async () => {
  await mkdir(path.join(root, "state"));
  const source = normalizeSource({ url: defaults[0].source.url.replace(/\.git$/, "") });
  await writeFile(path.join(root, "state/marketplaces.json"), JSON.stringify([
    { id: sourceIdentity(source), title: "Saved source", source, updatedAt: "2026-01-01", entries: [] },
    { id: "custom", title: "Custom source", source: { url: "https://git.example.org/custom.git" }, updatedAt: "2026-01-01", entries: [] },
  ]), "utf8");
  const snapshot = await service.snapshot();
  expect(snapshot.markets.map((market) => market.title)).toEqual(["Saved source", "Custom source", "Default second"]);
  await service.snapshot();
  expect(calls).toEqual([defaults[1].source.url]);
});
it("retains a failed source, loads the other source, and retries only on request", async () => {
  failed = true;
  await service.snapshot();
  const settled = await service.snapshot();
  expect(settled.markets[0]).toMatchObject({ updatedAt: "", syncError: "Connection unavailable" });
  expect(settled.markets[1].entries).toHaveLength(1);
  await service.dispose(); service = createCatalogService(ports());
  await service.snapshot();
  expect(calls).toHaveLength(2);
  failed = false;
  await service.refreshMarket(settled.markets[0].id);
  const refreshed = (await service.snapshot()).markets[0];
  expect(refreshed.syncError).toBeUndefined();
  expect(refreshed.entries).toHaveLength(1);
});

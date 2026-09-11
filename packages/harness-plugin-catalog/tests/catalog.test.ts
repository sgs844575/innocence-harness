import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCatalogService, normalizeSource, type CatalogService, type GitPort } from "../src/index";

let root: string;
let repo: string;
let service: CatalogService;
let fail = false;
const source = { url: "https://git.example.org/team/extensions.git" };
const fakeGit = (): GitPort => ({ async checkout(_source, destination) { if (fail) throw new Error("Network unavailable"); await cp(repo, destination, { recursive: true }); return "a".repeat(40); } });
const write = async (relative: string, value: unknown) => {
  const file = path.join(repo, relative); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value), "utf8");
};
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "catalog-test-"));
  repo = path.join(root, "repo"); await mkdir(repo); fail = false;
  service = createCatalogService({ getStateRoot: () => path.join(root, "state"), getPluginRoot: () => path.join(root, "plugins"), git: fakeGit() });
});
afterEach(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }); });
async function bundle(prefix = "") {
  await write(`${prefix}.codex-plugin/plugin.json`, { name: "review-helper", version: "1.0.0", skills: "./custom-skills", hooks: "./hooks.json" });
  await write(`${prefix}hooks.json`, { hooks: { Stop: [{ hooks: [{ type: "command", command: "node finish.js" }] }] } });
  await write(`${prefix}custom-skills/review/SKILL.md`, "---\nname: review\ndescription: Review changes\n---\nReview the current changes.");
}
describe("plugin catalog", () => {
  it("previews without installing, installs custom component paths, updates, and uninstalls only managed copies", async () => {
    await bundle();
    const preview = await service.preview(source);
    expect(preview).toMatchObject({ title: "review-helper", components: ["skills", "hooks"], unsupported: [], installable: true, replacing: false });
    expect((await service.snapshot()).installed).toEqual([]);
    await service.install(preview.token);
    expect((await service.snapshot()).installed).toHaveLength(1);
    const next = await service.preview(source);
    expect(next.replacing).toBe(true);
    await service.install(next.token);
    expect(await readFile(path.join(root, "plugins", next.id, "custom-skills/review/SKILL.md"), "utf8")).toContain("Review the current changes.");
    await expect(service.uninstall("../repo")).rejects.toThrow("managed");
    await service.uninstall(next.id);
    expect((await service.snapshot()).installed).toEqual([]);
  });
  it("accepts both catalog layouts and isolates unsupported entries", async () => {
    await write(".agents/plugins/marketplace.json", { name: "team", interface: { displayName: "Team tools" }, plugins: [
      { name: "review", source: { source: "local", path: "./plugins/review" } },
      { name: "remote", source: { source: "git-subdir", url: source.url, path: "plugins/remote", sha: "abc123" } },
      { name: "registry", source: { source: "npm", package: "tool" } },
      { name: "blocked", source: "./blocked", policy: { installation: "NOT_AVAILABLE" } },
      { name: "escape", source: "../escape" },
    ] });
    await service.addMarket(source);
    const market = (await service.snapshot()).markets[0];
    expect(market.title).toBe("Team tools");
    expect(market.entries[0].source?.path).toBe("plugins/review");
    expect(market.entries[1].source?.ref).toBe("abc123");
    expect(market.entries.slice(2).every((row) => row.unavailable && !row.source)).toBe(true);
    await rm(path.join(repo, ".agents"), { recursive: true });
    await write(".claude-plugin/marketplace.json", { name: "team", plugins: [{ name: "local", source: "./plugin" }] });
    await service.refreshMarket(market.id);
    expect((await service.snapshot()).markets[0].entries[0].name).toBe("local");
  });
  it("retains the last catalog on refresh failure and leaves installations when removing a market", async () => {
    await bundle();
    await write("marketplace.json", { name: "test", plugins: [{ name: "review-helper", source: "./" }] });
    await service.addMarket(source);
    await service.install((await service.preview(source)).token);
    const market = (await service.snapshot()).markets[0];
    fail = true;
    await expect(service.refreshMarket(market.id)).rejects.toThrow("Network unavailable");
    expect((await service.snapshot()).markets[0]).toEqual(market);
    await service.removeMarket(market.id);
    expect((await service.snapshot()).installed).toHaveLength(1);
    expect(await readdir(path.join(root, "state", "staging"))).toEqual([]);
  });
  it("blocks unsupported-only bundles and unbuilt native repositories", async () => {
    await write(".codex-plugin/plugin.json", { name: "connector", apps: "./.app.json" });
    const preview = await service.preview(source);
    expect(preview.installable).toBe(false);
    await expect(service.install(preview.token)).rejects.toThrow("no supported");
    await service.discard(preview.token);
    await rm(path.join(repo, ".codex-plugin"), { recursive: true });
    await write("package.json", { name: "native-extension" });
    expect((await service.preview(source)).unsupported).toEqual(["buildRequired"]);
  });
  it("refuses overwriting an unmanaged directory even when its generated id matches", async () => {
    await bundle(); const preview = await service.preview(source);
    await mkdir(path.join(root, "plugins", preview.id), { recursive: true });
    await expect(service.install(preview.token)).rejects.toThrow("unmanaged");
  });
  it("rejects directory links in downloaded content", async () => {
    await bundle();
    await mkdir(path.join(root, "outside"));
    await symlink(path.join(root, "outside"), path.join(repo, "linked"), "junction");
    await expect(service.preview(source)).rejects.toThrow("link");
  });
  it("disposes a prepared checkout and rejects further work", async () => {
    await bundle(); await service.preview(source); await service.dispose();
    expect(await readdir(path.join(root, "state", "staging"))).toEqual([]);
    await expect(service.snapshot()).rejects.toThrow("closed");
  });
  it("schedules default market syncs in the background and settles them on a later snapshot", async () => {
    await write("marketplace.json", { name: "test", plugins: [{ name: "review-helper", source: "./" }] });
    const local = createCatalogService({ getStateRoot: () => path.join(root, "state"), getPluginRoot: () => path.join(root, "plugins"), git: fakeGit(), defaultMarkets: [{ title: "Default market", source }] });
    try {
      const first = await local.snapshot();
      expect(first.markets[0]).toMatchObject({ syncing: true, entries: [] });
      // A second snapshot queues behind the background sync, so it observes the settled state.
      const second = await local.snapshot();
      expect(second.markets[0].syncing).toBeUndefined();
      expect(second.markets[0].entries.map((row) => row.name)).toEqual(["review-helper"]);
      expect(second.markets[0].updatedAt).not.toBe("");
    } finally { await local.dispose(); }
  });
  it("keeps a sync failure browsable instead of blocking the first snapshot", async () => {
    fail = true;
    const local = createCatalogService({ getStateRoot: () => path.join(root, "state"), getPluginRoot: () => path.join(root, "plugins"), git: fakeGit(), defaultMarkets: [{ title: "Default market", source }] });
    try {
      const first = await local.snapshot();
      expect(first.markets[0]).toMatchObject({ syncing: true });
      const second = await local.snapshot();
      expect(second.markets[0].syncing).toBeUndefined();
      expect(second.markets[0].syncError).toBe("Network unavailable");
    } finally { await local.dispose(); }
  });
  it("reschedules a market whose persisted syncing flag was left by a previous run", async () => {
    await write("marketplace.json", { name: "test", plugins: [{ name: "review-helper", source: "./" }] });
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "marketplaces.json"), JSON.stringify({ markets: [{ id: "stale", title: "Default market", source, updatedAt: "", syncing: true, entries: [] }], seededDefaults: ["stale"] }), "utf8");
    const local = createCatalogService({ getStateRoot: () => stateRoot, getPluginRoot: () => path.join(root, "plugins"), git: fakeGit(), defaultMarkets: [{ title: "Default market", source }] });
    try {
      await local.snapshot();
      const settled = await local.snapshot();
      expect(settled.markets).toHaveLength(1);
      expect(settled.markets[0].syncing).toBeUndefined();
      expect(settled.markets[0].entries.map((row) => row.name)).toEqual(["review-helper"]);
    } finally { await local.dispose(); }
  });
});
describe("Git source validation", () => {
  it("normalizes remote sources and rejects local paths, command options, credential URLs and traversal", () => {
    expect(normalizeSource({ url: "team/tools" }).url).toBe("https://github.com/team/tools.git");
    expect(normalizeSource({ url: "git@git.example.org:team/tools.git" }).url).toBe("ssh://git@git.example.org/team/tools.git");
    for (const url of ["file:///tmp/repo", "--upload-pack=bad", "https://user:secret@git.example.org/repo", "ext::command"]) expect(() => normalizeSource({ url })).toThrow();
    for (const subdir of ["../outside", "C:/outside", "/outside", "safe/../../outside"]) expect(() => normalizeSource({ ...source, path: subdir })).toThrow();
    expect(() => normalizeSource({ ...source, ref: "--upload-pack=bad" })).toThrow();
  });
});

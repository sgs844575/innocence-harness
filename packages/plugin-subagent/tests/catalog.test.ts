import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPresetCatalog, createScopedSubagentPlugin, presetCatalog, BUILTIN_PRESETS, type SavedPreset } from "../src";

const roots: string[] = [];
async function root() { const dir = await mkdtemp(path.join(os.tmpdir(), "subagent-catalog-")); roots.push(dir); return dir; }
afterEach(async () => { await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const custom: SavedPreset = { id: "review", title: "Reviewer", description: "Review changes", systemPrompt: "Review the changes and report defects.", tools: "readOnly", enabled: true };

describe("scoped subagent catalog", () => {
  it("persists global entries, isolates projects and restores inheritance after deletion", async () => {
    const user = await root(), project = await root(), other = await root();
    const store = createPresetCatalog(BUILTIN_PRESETS);
    await store.save(user, custom, true);
    await store.save(project, { ...custom, title: "Project reviewer", enabled: false }, true);
    expect((await store.list(user, project)).find((p) => p.id === custom.id)).toMatchObject({ source: "project", enabled: false });
    expect((await createPresetCatalog(BUILTIN_PRESETS).list(user, other)).find((p) => p.id === custom.id)).toMatchObject({ source: "global", title: "Reviewer" });
    await store.remove(project, custom.id);
    expect((await store.list(user, project)).find((p) => p.id === custom.id)?.source).toBe("global");
  });
  it("protects system entries and rejects duplicate creation, missing updates and malformed storage", async () => {
    const user = await root(); const store = createPresetCatalog(BUILTIN_PRESETS);
    await expect(store.save(user, { ...custom, id: "explore" }, true)).rejects.toThrow("read-only");
    await expect(store.remove(user, "general")).rejects.toThrow("read-only");
    await expect(store.save(user, custom, false)).rejects.toThrow("no longer exists");
    await store.save(user, custom, true);
    await expect(store.save(user, custom, true)).rejects.toThrow("already exists");
    await writeFile(path.join(user, "subagents.json"), "invalid", "utf8");
    await expect(store.save(user, custom, false)).rejects.toThrow();
  });
  it("serializes independent writes without losing entries", async () => {
    const user = await root(); const store = createPresetCatalog([]);
    await Promise.all([store.save(user, custom, true), store.save(user, { ...custom, id: "audit" }, true)]);
    expect(await store.list(user)).toHaveLength(2);
  });
  it("registers enabled scoped presets and executes their prompt and tool policy", async () => {
    const user = await root(), project = await root();
    await presetCatalog.save(user, custom, true);
    const register = vi.fn();
    (await createScopedSubagentPlugin(user, project)).apply({ tools: { register } } as never);
    const tool = register.mock.calls[0][0];
    const run = vi.fn(async () => ({ finalText: "Reviewed", turns: 1 }));
    await tool.execute({ agentType: custom.id, prompt: "Inspect changes" }, { subagent: { run } });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ tools: "readOnly", systemPrompt: expect.stringContaining(custom.systemPrompt) }));
    await presetCatalog.save(project, { ...custom, enabled: false }, true);
    const disabled = vi.fn();
    (await createScopedSubagentPlugin(user, project)).apply({ tools: { register: disabled } } as never);
    expect(disabled.mock.calls[0][0].parameters.properties.agentType.enum).not.toContain(custom.id);
  });
});

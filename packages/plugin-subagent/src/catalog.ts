import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SubagentPreset } from "./index";

export interface SavedPreset extends SubagentPreset { enabled: boolean }
export interface CatalogPreset extends SavedPreset { source: "system" | "global" | "project" }

export function createPresetCatalog(system: readonly SubagentPreset[]) {
  const reserved = new Set(system.map((preset) => preset.id));
  const queues = new Map<string, Promise<unknown>>();
  function validate(value: unknown): SavedPreset {
    if (!value || typeof value !== "object") throw new Error("Invalid subagent configuration.");
    const p = value as SavedPreset;
    if (typeof p.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(p.id)) throw new Error("Use a lowercase identifier with letters, numbers and hyphens.");
    if (reserved.has(p.id)) throw new Error("System subagents are read-only.");
    for (const field of ["title", "description", "systemPrompt"] as const) {
      if (typeof p[field] !== "string" || !p[field].trim() || p[field].length > 100000) throw new Error(`Invalid ${field}.`);
    }
    if (!["all", "readOnly"].includes(p.tools) || typeof p.enabled !== "boolean") throw new Error("Invalid subagent options.");
    return { id: p.id, title: p.title.trim(), description: p.description.trim(), systemPrompt: p.systemPrompt.trim(), tools: p.tools, enabled: p.enabled };
  }
  const file = (root: string) => path.join(root, "subagents.json");
  async function read(root: string): Promise<SavedPreset[]> {
    let raw: string;
    try { raw = await readFile(file(root), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error("Invalid subagent catalog.");
    const result = data.map(validate);
    if (new Set(result.map((p) => p.id)).size !== result.length) throw new Error("Duplicate subagent identifiers.");
    return result;
  }
  async function change(root: string, update: (rows: SavedPreset[]) => SavedPreset[]) {
    const key = path.resolve(root);
    const previous = queues.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const rows = update(await read(root));
      await mkdir(root, { recursive: true });
      const temporary = `${file(root)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(rows, null, 2), { encoding: "utf8", flag: "wx" });
        await rename(temporary, file(root));
      } finally { await unlink(temporary).catch(() => {}); }
    });
    queues.set(key, pending);
    try { await pending; } finally { if (queues.get(key) === pending) queues.delete(key); }
  }
  return {
    async list(userRoot: string, projectRoot?: string): Promise<CatalogPreset[]> {
      const merged = new Map<string, CatalogPreset>();
      for (const p of system) merged.set(p.id, { ...p, enabled: true, source: "system" });
      for (const p of await read(userRoot)) merged.set(p.id, { ...p, source: "global" });
      if (projectRoot) for (const p of await read(projectRoot)) merged.set(p.id, { ...p, source: "project" });
      return [...merged.values()];
    },
    async save(root: string, input: SavedPreset, create: boolean) {
      const preset = validate(input);
      await change(root, (rows) => {
        const exists = rows.some((p) => p.id === preset.id);
        if (create && exists) throw new Error("A subagent with this identifier already exists.");
        if (!create && !exists) throw new Error("Subagent no longer exists.");
        return [...rows.filter((p) => p.id !== preset.id), preset];
      });
    },
    async remove(root: string, id: string) {
      if (reserved.has(id)) throw new Error("System subagents are read-only.");
      await change(root, (rows) => rows.filter((p) => p.id !== id));
    },
  };
}
export type PresetCatalog = ReturnType<typeof createPresetCatalog>;

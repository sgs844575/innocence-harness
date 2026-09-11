import path from "node:path";
import { json, record, safePath, string } from "./files";
import { normalizeSource } from "./git";
import type { CatalogEntry, RepositorySource } from "./protocol";

const manifests = [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json", "marketplace.json"];
export async function readMarketplace(root: string, source: RepositorySource): Promise<{ title: string; entries: CatalogEntry[] }> {
  let raw: unknown;
  for (const manifest of manifests) {
    raw = await json(path.join(root, manifest));
    if (raw !== undefined) { await safePath(root, manifest); break; }
  }
  const data = record(raw);
  if (!Array.isArray(data.plugins) || !string(data.name)) throw new Error("No valid marketplace catalog found in this repository directory.");
  const names = new Set<string>();
  const entries = data.plugins.map((value): CatalogEntry => {
    const row = record(value);
    const name = string(row.name);
    if (!name || names.has(name)) throw new Error("Marketplace has an empty or duplicate plugin name.");
    names.add(name);
    const entry: CatalogEntry = { name, description: string(row.description) || string(record(row.interface).shortDescription), version: string(row.version) || undefined, category: string(row.category) || undefined };
    try {
      if (record(row.policy).installation === "NOT_AVAILABLE") throw new Error("Installation is disabled by the marketplace.");
      const spec = record(row.source);
      const kind = string(spec.source);
      const local = typeof row.source === "string" ? row.source : kind === "local" ? string(spec.path) : "";
      if (local) {
        const prefix = string(record(data.metadata).pluginRoot);
        const relative = path.posix.join(source.path ?? ".", prefix, local);
        // Validate each operand before joining, so normalization cannot hide traversal.
        for (const part of [prefix, local]) normalizeSource({ ...source, path: part || "." });
        entry.source = normalizeSource({ ...source, path: relative });
      } else if (["url", "git-subdir", "github"].includes(kind)) {
        entry.source = normalizeSource({ url: string(kind === "github" ? spec.repo : spec.url), ref: string(spec.sha) || string(spec.ref) || undefined, path: string(spec.path) || "." });
      } else throw new Error("This source requires a package registry or a host account connection.");
      if (Array.isArray(row.dependencies) && row.dependencies.length) throw new Error("This plugin declares dependencies that require manual installation.");
      if (row.strict === false && ["commands", "skills", "hooks", "mcpServers"].some((key) => row[key] !== undefined)) throw new Error("Inline marketplace components are not supported; use a plugin manifest.");
    } catch (error) { entry.source = undefined; entry.unavailable = error instanceof Error ? error.message : String(error); }
    return entry;
  });
  return { title: string(record(data.interface).displayName) || string(data.name), entries };
}

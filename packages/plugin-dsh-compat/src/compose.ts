import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Composition layer of the reference harness (dsh): YAML patch files list the
 * Cordis plugin modules a setup runs (`cordis.patch.yml` / `cordis.yml`, with
 * `- insert: [...]` op rows or plain `- name: <specifier>` entry rows, plus
 * `- remove: [...]`). This module discovers those files under the configured
 * roots and normalizes their rows. It owns no kernel coupling, so every rule
 * here is unit-testable in isolation.
 */

/** One normalized module entry from a composition file. */
export interface CompositionEntry {
  /** Entry id (row id, or derived from the module specifier). */
  id: string;
  /** Module specifier: absolute/relative path or bare package name. */
  name: string;
  /** Row config carried to the plugin as the second `apply` argument. */
  config?: unknown;
  /** Directory bare specifiers resolve from (patch dir or bundle dir). */
  baseDir: string;
}

/** A load failure discovered while scanning one root. */
export interface CompositionFailure {
  /** Human-readable origin: patch file path or bundle directory. */
  source: string;
  reason: string;
}

/** Result of scanning one composition root. */
export interface CompositionScan {
  entries: CompositionEntry[];
  failures: CompositionFailure[];
}

/** Raw entry row as it appears in a patch document. */
interface RawEntry {
  id?: string;
  name: string;
  config?: unknown;
}

/** Candidate patch file names at a root, most specific first. */
const PATCH_FILENAMES = ["cordis.patch.yml", "cordis.yml"] as const;

/**
 * Parses one patch document into entry rows and removals. Supported row
 * shapes: plain strings, entry objects (`name`, optional `id`/`config`),
 * `insert` op objects (recursed into their list), and `remove` op objects
 * (collected by id or name). `edit` ops are counted and ignored — the
 * compatibility layer keeps no per-row config tree to merge into. Anything
 * else is reported through `problems` without aborting the document.
 */
export function parsePatchDocument(
  text: string,
): { entries: RawEntry[]; removals: string[]; problems: string[] } {
  const entries: RawEntry[] = [];
  const removals: string[] = [];
  const problems: string[] = [];
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (err) {
    throw new Error(`patch YAML is not parseable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (document === null || document === undefined) return { entries, removals, problems };
  if (!Array.isArray(document)) {
    throw new Error("patch document must be a YAML list of rows");
  }
  const consumeRow = (row: unknown, depth: number): void => {
    if (typeof row === "string") {
      if (row.trim().length > 0) entries.push({ name: row.trim() });
      return;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      problems.push(`unsupported row: ${preview(row)}`);
      return;
    }
    const record = row as Record<string, unknown>;
    if (Array.isArray(record.insert)) {
      if (depth >= 8) {
        problems.push("insert nesting too deep");
        return;
      }
      for (const inner of record.insert) consumeRow(inner, depth + 1);
      return;
    }
    if (Array.isArray(record.remove)) {
      for (const target of record.remove) removals.push(removalKey(target));
      return;
    }
    if ("edit" in record) {
      problems.push("edit ops are ignored by the compatibility layer");
      return;
    }
    const name = record.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      problems.push(`row without a module specifier: ${preview(row)}`);
      return;
    }
    entries.push({
      ...(typeof record.id === "string" && record.id.trim().length > 0 ? { id: record.id.trim() } : {}),
      name: name.trim(),
      ...("config" in record ? { config: record.config } : {}),
    });
  };
  for (const row of document) consumeRow(row, 0);
  return { entries, removals, problems };
}

/** Stable key of one accumulated entry for dedupe and removal matching. */
function entryKey(entry: { id?: string; name: string }): string {
  return entry.id !== undefined ? `id:${entry.id}` : `name:${entry.name}`;
}

/** Normalizes one `remove` list member to a removal key. */
function removalKey(target: unknown): string {
  if (typeof target === "string") return target.includes(":") ? target : `id:${target}`;
  if (target && typeof target === "object") {
    const record = target as Record<string, unknown>;
    if (typeof record.id === "string") return `id:${record.id}`;
    if (typeof record.name === "string") return `name:${record.name}`;
  }
  return "";
}

function preview(value: unknown): string {
  try {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  } catch {
    return String(value);
  }
}

/** Derives a stable entry id from a module specifier. */
export function deriveEntryId(specifier: string): string {
  const base = path.basename(specifier.replace(/\\/g, "/"));
  const stripped = base.replace(/\.[^./]+$/, "");
  const sanitized = stripped.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "plugin";
}

/** Drops accumulated entries matched by `removals` (id or name). */
function applyRemovals<T extends { id?: string; name: string }>(entries: T[], removals: string[]): T[] {
  if (removals.length === 0) return entries;
  const keys = new Set(removals.filter((key) => key !== ""));
  if (keys.size === 0) return entries;
  return entries.filter((entry) => !keys.has(entryKey(entry)) && !keys.has(`name:${entry.name}`));
}

/** Reads the first existing patch filename under `dir`, if any. */
async function firstPatchFile(dir: string): Promise<string | undefined> {
  for (const filename of PATCH_FILENAMES) {
    const candidate = path.join(dir, filename);
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // absent — try the next name
    }
  }
  return undefined;
}

/** Resolves the patch file of a bundle directory (`dsh.bundle.patch`), if any. */
async function bundlePatchFile(dir: string): Promise<string | undefined> {
  const manifest = path.join(dir, "package.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifest, "utf8"));
  } catch {
    return undefined; // not a bundle layout (or unreadable) — not an error
  }
  const patch = (parsed as { dsh?: { bundle?: { patch?: unknown } } })?.dsh?.bundle?.patch;
  if (typeof patch !== "string" || patch.length === 0) return undefined;
  return path.resolve(dir, patch);
}

/**
 * Scans one composition root: its own patch file (if present) plus every
 * immediate subdirectory that is a bundle (package.json declaring
 * `dsh.bundle.patch`). Rows accumulate across files in scan order; `remove`
 * ops drop previously accumulated entries, matching the reference harness's
 * later-layer-wins semantics. Missing roots scan to nothing — an unconfigured
 * root is not a failure.
 */
export async function scanCompositionRoot(root: string): Promise<CompositionScan> {
  const entries: CompositionEntry[] = [];
  const failures: CompositionFailure[] = [];
  const seen = new Set<string>();
  const collect = async (patchFile: string, baseDir: string): Promise<void> => {
    let text: string;
    try {
      text = await readFile(patchFile, "utf8");
    } catch (err) {
      failures.push({ source: patchFile, reason: reasonOf(err) });
      return;
    }
    let parsed;
    try {
      parsed = parsePatchDocument(text);
    } catch (err) {
      failures.push({ source: patchFile, reason: reasonOf(err) });
      return;
    }
    for (const problem of parsed.problems) {
      failures.push({ source: patchFile, reason: problem });
    }
    const kept = applyRemovals(parsed.entries, parsed.removals);
    for (const row of kept) {
      const id = row.id ?? deriveEntryId(row.name);
      const key = `${baseDir}\0${row.name}`;
      if (seen.has(key)) continue; // same module declared twice — first wins
      seen.add(key);
      entries.push({
        id,
        name: row.name,
        ...("config" in row ? { config: row.config } : {}),
        baseDir,
      });
    }
  };
  let rootExists = true;
  try {
    await stat(root);
  } catch {
    rootExists = false;
  }
  if (rootExists) {
    const rootPatch = await firstPatchFile(root);
    if (rootPatch) await collect(rootPatch, path.dirname(rootPatch));
    let children: import("node:fs").Dirent[] = [];
    try {
      children = await readdir(root, { withFileTypes: true });
    } catch (err) {
      failures.push({ source: root, reason: reasonOf(err) });
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const dir = path.join(root, child.name);
      const bundlePatch = await bundlePatchFile(dir);
      if (bundlePatch) await collect(bundlePatch, path.dirname(bundlePatch));
    }
  }
  return { entries, failures };
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

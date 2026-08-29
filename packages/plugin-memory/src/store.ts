// Memory store (batch 4B task 1): pure Node surface, no host dependencies.
// Entries live at <root>/memory/<id>.md as YAML frontmatter (id, scope, tags,
// updated) plus a markdown body. Multi-root listing merges by id with the
// FIRST root winning — the composition passes [userRoot, projectRoot], so a
// user entry shadows the project entry of the same id (same direction as the
// plugin resolver's dual roots, where the user root shadows the builtin).
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Directory name under each root holding the entry files. */
const MEMORY_DIR = "memory";

/**
 * id 必须是单段安全文件名（防路径逃逸）。对齐宿主加载器的 plain-plugin-id
 * 规则与 install_user_plugin 的 validSegment：拒绝点前缀、路径分隔符、
 * 驱动器号、首尾空白；因此 "."、".."、".hidden"、"C:"、"a/b" 一律非法。
 */
export function validMemoryId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !value.startsWith(".") &&
    !/[\\/:]/.test(value)
  );
}

/** Storage scope of an entry: "user" spans projects, "project" stays local. */
export type MemoryScope = "user" | "project";

/** Parsed entry: frontmatter metadata plus the body after the closing fence. */
export interface MemoryEntry {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly tags: readonly string[];
  readonly updated?: string;
  readonly body: string;
}

/** Index projection of one entry (no body — listings never carry content). */
export interface MemoryIndexEntry {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly tags: readonly string[];
  readonly firstLine: string;
}

/** Merge result: shadowed index rows plus per-file degradation warnings. */
export interface MemoryIndex {
  readonly entries: readonly MemoryIndexEntry[];
  readonly warnings: readonly string[];
}

/** Write input: id/scope/tags plus the full replacement body. */
export type MemoryWriteInput = Omit<MemoryEntry, "updated">;

function stringField(meta: unknown, key: string): string | undefined {
  if (typeof meta !== "object" || meta === null) return undefined;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function tagsField(meta: unknown): readonly string[] {
  if (typeof meta !== "object" || meta === null) return [];
  const value = (meta as Record<string, unknown>).tags;
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
}

/**
 * Parses one entry file. `---`-delimited YAML frontmatter (same shape as the
 * skill-file precedent), body after the closing fence. Degrades to a reason
 * string instead of throwing: the caller turns it into a skip-plus-warning.
 */
function parseEntryFile(file: string, raw: string): { entry: MemoryEntry } | { reason: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { reason: "missing or unterminated frontmatter" };
  let meta: unknown;
  try {
    meta = parseYaml(match[1]);
  } catch {
    return { reason: "unparseable frontmatter" };
  }
  const id = stringField(meta, "id");
  // 文件名是 id 的权威：frontmatter id 缺失、非法或与文件名漂移都算坏条目
  // （防手改文件偷换身份）。
  const expected = file.replace(/\.md$/, "");
  if (!validMemoryId(id) || id !== expected) {
    return { reason: "frontmatter id is missing, invalid, or drifts from the file name" };
  }
  const rawScope = stringField(meta, "scope");
  const scope: MemoryScope = rawScope === "user" ? "user" : "project";
  const updated = stringField(meta, "updated");
  return {
    entry: {
      id,
      scope,
      tags: tagsField(meta),
      ...(updated ? { updated } : {}),
      body: match[2].replace(/^\r?\n/, "").trimEnd(),
    },
  };
}

/** First non-empty body line (index preview); empty string when none. */
function firstLineOf(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function entryFile(root: string, id: string): string {
  return path.join(root, MEMORY_DIR, `${id}.md`);
}

async function readRootEntries(root: string, warnings: string[]): Promise<MemoryEntry[]> {
  let names: readonly string[];
  try {
    names = await fs.readdir(path.join(root, MEMORY_DIR));
  } catch {
    return []; // 无 memory 目录的根就是空根——不是告警
  }
  const entries: MemoryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const raw = await fs.readFile(path.join(root, MEMORY_DIR, name), "utf8").catch(() => null);
    if (raw === null) continue; // 读取竞态（并发删除）：静默跳过
    const parsed = parseEntryFile(name, raw);
    if ("entry" in parsed) entries.push(parsed.entry);
    else warnings.push(`${MEMORY_DIR}/${name}: ${parsed.reason}`);
  }
  return entries;
}

/**
 * Merged multi-root index. Roots order IS the shadow order: the first root
 * holding an id wins (composition passes user first, so user shadows project).
 * Entries sort by id for a stable listing; degradation warnings carry file
 * names and reasons only — never entry content.
 */
export async function listEntries(roots: readonly string[]): Promise<MemoryIndex> {
  const warnings: string[] = [];
  const byId = new Map<string, MemoryEntry>();
  for (const root of roots) {
    for (const entry of await readRootEntries(root, warnings)) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }
  const entries = [...byId.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id, scope, tags, body }) => ({ id, scope, tags, firstLine: firstLineOf(body) }));
  return { entries, warnings };
}

/**
 * Reads the visible entry for one id across the shadow-ordered roots; the
 * first root that holds it wins. Undefined when no root has it.
 */
export async function readEntry(roots: readonly string[], id: string): Promise<MemoryEntry | undefined> {
  if (!validMemoryId(id)) return undefined;
  for (const root of roots) {
    const raw = await fs.readFile(entryFile(root, id), "utf8").catch(() => null);
    if (raw === null) continue;
    const parsed = parseEntryFile(`${id}.md`, raw);
    if ("entry" in parsed) return parsed.entry;
    // 坏条目在此根不可见：继续找后面的根（不在此产生告警——告警面归 list）。
  }
  return undefined;
}

/**
 * Writes one entry file under <root>/memory/. Whole-document replacement
 * semantics belong to the caller (the write tool's overwrite gate); the store
 * only refuses unsafe ids before any path is built. Direct writeFile matches
 * the repository's existing write precedents (install_user_plugin, skills
 * staging) — no rename-based atomic writer exists to reuse, and the memory
 * format keeps a write idempotent on retry.
 */
export async function writeEntry(root: string, entry: MemoryWriteInput): Promise<void> {
  if (!validMemoryId(entry.id)) {
    throw new Error("id 必须是非空单段文件名（禁止路径分隔符、点前缀、首尾空白）");
  }
  const frontmatter = stringifyYaml({
    id: entry.id,
    scope: entry.scope,
    ...(entry.tags.length > 0 ? { tags: [...entry.tags] } : {}),
    updated: new Date().toISOString(),
  });
  const file = `---\n${frontmatter}---\n${entry.body.trim()}\n`;
  await fs.mkdir(path.join(root, MEMORY_DIR), { recursive: true });
  await fs.writeFile(entryFile(root, entry.id), file, "utf8");
}

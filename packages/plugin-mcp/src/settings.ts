// MCP 标准格式导入（任务 5）：解析项目根 .mcp.json（标准 { mcpServers } 形状），
// 合并进 <root>/.innocence/config.json 的 mcpServers（同名跳过；先读后合并，
// 不丢 permissions 等既有键；已有键在前新键追加）。写入经显式 UTF-8 fs。
// parse 对损坏输入抛错，由 UI 层降级提示（不炸）。
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { isMcpServerEntry, type McpServerEntry } from "./config";
export type { McpServerEntry } from "./config";

/** Import outcome per server name. */
export interface McpImportResult {
  imported: string[];
  skipped: { name: string; reason: "duplicate" | "invalid-entry" }[];
}

export type McpSettingsLocation = string | { directory: string };
const directoryOf = (root: McpSettingsLocation) => typeof root === "string" ? path.join(root, ".innocence") : root.directory;

interface ParsedMcpImport {
  servers: Record<string, McpServerEntry>;
  invalid: string[];
}

/**
 * Parses standard .mcp.json text ({ mcpServers: {...} }). Corrupt JSON,
 * non-object roots, and non-object mcpServers throw — the caller degrades.
 */
export function parseMcpJson(text: string): Record<string, McpServerEntry> {
  return parseMcpImport(text).servers;
}

export function parseMcpImport(text: string): ParsedMcpImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid mcp config: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid mcp config: not an object");
  }
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
    throw new Error("invalid mcp config: mcpServers missing or not an object");
  }
  const valid: Record<string, McpServerEntry> = Object.create(null);
  const invalid: string[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (!isMcpServerEntry(entry)) {
      invalid.push(name);
      continue;
    }
    valid[name] = entry;
  }
  return { servers: valid, invalid };
}


/** Reads <root>/.innocence/config.json; missing -> {}; corrupt -> rethrow. */
async function readConfig(root: McpSettingsLocation): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(directoryOf(root), "config.json"), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid innocence config: not an object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Merges servers into <root>/.innocence/config.json's mcpServers: existing
 * names are skipped (duplicate); other config keys (permissions etc.) are
 * preserved; existing keys keep their order with new keys appended.
 */
async function writeServers(
  servers: Record<string, McpServerEntry>,
  root: McpSettingsLocation,
  invalid: readonly string[] = [],
  edit?: (servers: Record<string, McpServerEntry>) => void,
): Promise<McpImportResult> {
  const dir = directoryOf(root);
  let configPath = path.join(dir, "config.json");
  const dirStat = await fs.lstat(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (dirStat?.isSymbolicLink()) {
    throw new Error("refusing to write through symlink .innocence directory");
  }
  if (dirStat && !dirStat.isDirectory()) {
    throw new Error("refusing to write through non-directory .innocence path");
  }
  const targetStat = await fs.lstat(configPath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (targetStat?.isSymbolicLink()) {
    throw new Error("refusing to write symlink config.json");
  }

  let config: Record<string, unknown> = {};
  try {
    config = await readConfig(root);
  } catch (err) {
    // ENOENT = create fresh; anything else (corrupt config) is fatal to us.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const existing = (config.mcpServers ?? {}) as Record<string, McpServerEntry>;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) throw new Error("Invalid mcpServers configuration.");
  const merged: Record<string, McpServerEntry> = { ...existing };
  edit?.(merged);
  const result: McpImportResult = {
    imported: [],
    skipped: invalid.map((name) => ({ name, reason: "invalid-entry" as const })),
  };
  for (const [name, entry] of Object.entries(servers)) {
    if (Object.prototype.hasOwnProperty.call(existing, name)) {
      result.skipped.push({ name, reason: "duplicate" });
      continue; // never overwrite an existing server
    }
    Object.defineProperty(merged, name, { value: entry, enumerable: true, configurable: true, writable: true });
    result.imported.push(name);
  }
  config.mcpServers = merged;
  const serialized = JSON.stringify(config, null, 2);
  await fs.mkdir(dir, { recursive: true });
  const postMkdirStat = await fs.lstat(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (postMkdirStat?.isSymbolicLink()) {
    throw new Error("refusing to write through symlink .innocence directory");
  }
  if (!postMkdirStat?.isDirectory()) {
    throw new Error("refusing to write through non-directory .innocence path");
  }
  // Bind subsequent writes to the canonical directory. If the lexical
  // `.innocence` path is swapped after this point, it cannot redirect writes.
  const stableDir = await fs.realpath(dir);
  const stableRoot = await fs.realpath(path.dirname(dir));
  if (stableDir !== path.join(stableRoot, path.basename(dir)) && !stableDir.startsWith(path.join(stableRoot, path.basename(dir)) + path.sep)) {
    throw new Error("refusing to write outside authorized workspace");
  }
  configPath = path.join(stableDir, "config.json");
  const tempPath = path.join(stableDir, `.config.json.${randomUUID()}.tmp`);
  let committed = false;
  try {
    await fs.writeFile(tempPath, serialized, { encoding: "utf8", flag: "wx" });
    const finalStat = await fs.lstat(configPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (finalStat?.isSymbolicLink()) {
      throw new Error("refusing to write symlink config.json");
    }
    await fs.rename(tempPath, configPath);
    committed = true;
  } finally {
    if (!committed) await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
  return result;
}

/** Returns <root>/.mcp.json if it exists (discovery hint), else null. */
export async function discoverMcpFile(root: string): Promise<string | null> {
  const file = path.join(root, ".mcp.json");
  const stat = await fs.stat(file).catch(() => null);
  return stat?.isFile() ? file : null;
}

const pending = new Map<string, Promise<unknown>>();
function serial<T>(root: McpSettingsLocation, action: () => Promise<T>): Promise<T> {
  const key = process.platform === "win32" ? path.resolve(directoryOf(root)).toLowerCase() : path.resolve(directoryOf(root));
  const run = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
  pending.set(key, run);
  void run.finally(() => { if (pending.get(key) === run) pending.delete(key); }).catch(() => {});
  return run;
}
export function importMcpServers(servers: Record<string, McpServerEntry>, root: McpSettingsLocation, invalid: readonly string[] = []): Promise<McpImportResult> {
  for (const entry of Object.values(servers)) if (!isMcpServerEntry(entry)) throw new Error("Invalid server configuration.");
  return serial(root, () => writeServers(servers, root, invalid));
}
export async function listMcpServers(root: McpSettingsLocation): Promise<Record<string, McpServerEntry>> {
  let config;
  try { config = await readConfig(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  const entries = config.mcpServers ?? {};
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Invalid mcpServers configuration.");
  return entries as Record<string, McpServerEntry>;
}
export function saveMcpServer(root: McpSettingsLocation, name: string, entry: McpServerEntry | null, create = false): Promise<void> {
  if (typeof name !== "string" || !name.trim() || name.length > 128 || /[\x00-\x1f]/.test(name)) throw new Error("Invalid server name.");
  if (entry !== null && !isMcpServerEntry(entry)) throw new Error("Invalid server configuration.");
  return serial(root, async () => { await writeServers({}, root, [], (servers) => {
    const exists = Object.hasOwn(servers, name);
    if (create && exists) throw new Error("Server name already exists.");
    if (!create && !exists) throw new Error("Server no longer exists. Refresh the list.");
    if (entry === null) delete servers[name];
    else Object.defineProperty(servers, name, { value: entry, enumerable: true, configurable: true, writable: true });
  }); });
}

// MCP 标准格式导入（任务 5）：解析项目根 .mcp.json（标准 { mcpServers } 形状），
// 合并进 <root>/.innocence/config.json 的 mcpServers（同名跳过；先读后合并，
// 不丢 permissions 等既有键；已有键在前新键追加）。写入经显式 UTF-8 fs。
// parse 对损坏输入抛错，由 UI 层降级提示（不炸）。
import fs from "node:fs/promises";
import path from "node:path";

/** One MCP server entry (standard .mcp.json / config.json shape). */
export interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Import outcome per server name. */
export interface McpImportResult {
  imported: string[];
  skipped: { name: string; reason: "duplicate" }[];
}

/**
 * Parses standard .mcp.json text ({ mcpServers: {...} }). Corrupt JSON,
 * non-object roots, and non-object mcpServers throw — the caller degrades.
 */
export function parseMcpJson(text: string): Record<string, McpServerEntry> {
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
  const valid: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (!isMcpServerEntry(entry)) continue;
    valid[name] = entry;
  }
  return valid;
}

function isMcpServerEntry(value: unknown): value is McpServerEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as { command?: unknown; args?: unknown; env?: unknown };
  if (typeof entry.command !== "string" || entry.command.trim() === "") return false;
  if (entry.args !== undefined && (!Array.isArray(entry.args) || !entry.args.every((arg) => typeof arg === "string"))) return false;
  if (entry.env !== undefined && (typeof entry.env !== "object" || entry.env === null || Array.isArray(entry.env))) return false;
  return true;
}

/** Reads <root>/.innocence/config.json; missing -> {}; corrupt -> rethrow. */
async function readConfig(root: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(root, ".innocence", "config.json"), "utf8");
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
export async function importMcpServers(
  servers: Record<string, McpServerEntry>,
  root: string,
): Promise<McpImportResult> {
  let config: Record<string, unknown> = {};
  try {
    config = await readConfig(root);
  } catch (err) {
    // ENOENT = create fresh; anything else (corrupt config) is fatal to us.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const existing = (config.mcpServers ?? {}) as Record<string, McpServerEntry>;
  const merged: Record<string, McpServerEntry> = { ...existing };
  const result: McpImportResult = { imported: [], skipped: [] };
  for (const [name, entry] of Object.entries(servers)) {
    if (Object.prototype.hasOwnProperty.call(existing, name)) {
      result.skipped.push({ name, reason: "duplicate" });
      continue; // never overwrite an existing server
    }
    merged[name] = entry; // append after existing keys
    result.imported.push(name);
  }
  config.mcpServers = merged;
  const dir = path.join(root, ".innocence");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "config.json"), JSON.stringify(config, null, 2), "utf8");
  return result;
}

/** Returns <root>/.mcp.json if it exists (discovery hint), else null. */
export async function discoverMcpFile(root: string): Promise<string | null> {
  const file = path.join(root, ".mcp.json");
  const stat = await fs.stat(file).catch(() => null);
  return stat?.isFile() ? file : null;
}

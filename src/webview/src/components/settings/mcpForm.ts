import type { McpServerEntry } from "../../../../shared/mcpSettingsIpc";

export function serverSummary(entry: McpServerEntry): string {
  return entry?.url ? `${entry.type ?? (/^wss?:/.test(entry.url) ? "ws" : "http")} · ${entry.url}` : `stdio · ${[entry?.command, ...(entry?.args ?? [])].filter(Boolean).join(" ")}`;
}
export function parseEditorJson(text: string): Record<string, McpServerEntry> {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Expected a server configuration object.");
  const servers = Object.hasOwn(raw, "mcpServers") ? (raw as { mcpServers: unknown }).mcpServers : raw;
  if (!servers || typeof servers !== "object" || Array.isArray(servers) || !Object.keys(servers).length) throw new Error("Add at least one server.");
  for (const value of Object.values(servers)) if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid server entry.");
  return servers as Record<string, McpServerEntry>;
}

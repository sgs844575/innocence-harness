import { parseServerAuthorizationConfig } from "@innocenceharness/harness-auth/config";

export interface McpServerEntry {
  timeout?: number;
  protocolVersion?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  type?: "stdio" | "http" | "sse" | "ws";
  headers?: Record<string, string>;
  oauth?: ReturnType<typeof parseServerAuthorizationConfig>;
  capability?: "computer";
  disabled?: boolean;
}

export function isMcpServerEntry(value: unknown): value is McpServerEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.timeout !== undefined && (!Number.isInteger(v.timeout) || Number(v.timeout) < 1 || Number(v.timeout) > 2147483647)) return false;
  if (v.protocolVersion !== undefined && !["2024-11-05", "2025-03-26", "2025-06-18"].includes(String(v.protocolVersion))) return false;
  if (v.disabled !== undefined && typeof v.disabled !== "boolean") return false;
  if (v.capability !== undefined && v.capability !== "computer") return false;
  for (const key of ["env", "headers"]) {
    const map = v[key];
    if (map !== undefined && (!map || typeof map !== "object" || Array.isArray(map) || Object.values(map).some((s) => typeof s !== "string"))) return false;
  }
  if (v.url !== undefined) {
    if (typeof v.url !== "string" || v.command !== undefined || v.args !== undefined || v.env !== undefined || v.cwd !== undefined) return false;
    try {
      const url = new URL(v.url);
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) return false;
      const websocket = url.protocol === "ws:" || url.protocol === "wss:";
      if (v.type !== undefined && !(websocket ? v.type === "ws" : v.type === "http" || v.type === "sse")) return false;
      if (!websocket && v.protocolVersion !== undefined) return false;
      parseServerAuthorizationConfig(v.oauth);
    } catch { return false; }
    return true;
  }
  return typeof v.command === "string" && !!v.command.trim()
    && (v.type === undefined || v.type === "stdio") && v.headers === undefined && v.oauth === undefined
    && (v.cwd === undefined || typeof v.cwd === "string" && !!v.cwd.trim())
    && (v.args === undefined || Array.isArray(v.args) && v.args.every((s) => typeof s === "string"));
}

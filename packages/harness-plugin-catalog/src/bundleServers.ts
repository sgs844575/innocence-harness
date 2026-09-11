import { parseServerAuthorizationConfig, type ServerAuthorizationConfig } from "@innocenceharness/harness-auth/config";
import path from "node:path";
import { exists, json, record, safePath } from "./files";

export type BundleServer = ({ command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { url: string; type?: "http" | "sse" | "ws"; headers?: Record<string, string>; oauth?: ServerAuthorizationConfig }) & { capability?: "computer" };
export interface BundleIssue { component: string; detail: string }
export interface BundleVariables { root: string; data: string; env: Record<string, string | undefined> }

/** External variable spellings are protocol keys, not host environment aliases. */
export function expandBundleValue(value: string, variables?: BundleVariables): string {
  if (!variables) return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, key: string, fallback: string | undefined) => {
    const resolved = ["PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"].includes(key) ? variables.root
      : ["PLUGIN_DATA", "CLAUDE_PLUGIN_DATA"].includes(key) ? variables.data : variables.env[key] ?? fallback;
    if (resolved === undefined) throw new Error(`Missing environment variable: ${key}`);
    return resolved;
  });
}
function strings(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((v) => typeof v !== "string")) throw new Error(`Invalid ${field}.`);
  return value as Record<string, string>;
}
function parseServer(value: unknown, variables?: BundleVariables): BundleServer {
  const config = record(value);
  if (config.disabled === true) throw new Error("Server is disabled by its configuration.");
  const expand = (text: string) => expandBundleValue(text, variables);
  const oauthValue = config.oauth && typeof config.oauth === "object" && !Array.isArray(config.oauth)
    ? Object.fromEntries(Object.entries(config.oauth).map(([key, value]) => [key, typeof value === "string" ? expand(value) : Array.isArray(value) ? value.map((item) => typeof item === "string" ? expand(item) : item) : value]))
    : config.oauth;
  const oauth = parseServerAuthorizationConfig(oauthValue, variables === undefined);
  const map = (values?: Record<string, string>) => values && Object.fromEntries(Object.entries(values).map(([key, val]) => [key, expand(val)]));
  if (typeof config.command === "string" && config.command.trim() && config.url === undefined) {
    if (oauth) throw new Error("Interactive authorization options require a URL transport.");
    if (config.type !== undefined && config.type !== "stdio") throw new Error("Unsupported process transport.");
    if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== "string"))) throw new Error("Invalid server arguments.");
    if (config.cwd !== undefined && typeof config.cwd !== "string") throw new Error("Invalid server working directory.");
    const cwd = typeof config.cwd === "string" ? expand(config.cwd) : variables?.root;
    return { command: expand(config.command), args: (config.args as string[] | undefined)?.map(expand), env: map(strings(config.env, "server environment")), cwd: cwd && variables ? path.resolve(variables.root, cwd) : cwd };
  }
  if (typeof config.url !== "string" || config.command !== undefined) throw new Error("A server requires a command or URL.");
  const url = expand(config.url);
  // Validation before installation must tolerate runtime environment placeholders.
  const parsed = new URL(variables ? url : url.replace(/\$\{[^}]+\}/g, "placeholder"));
  if (!["https:", "http:", "ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Invalid server URL.");
  const type = config.type ?? (parsed.protocol.startsWith("ws") ? "ws" : "http");
  if (!["http", "sse", "ws"].includes(type as string) || (type === "ws") !== parsed.protocol.startsWith("ws")) throw new Error("Unsupported server transport.");
  return { url, ...(oauth ? { oauth } : {}), type: type as "http" | "sse" | "ws", headers: map(strings(config.headers, "server headers")) };
}
/** Reads the default file plus explicitly configured files/inline entries, without launching processes. */
export async function readBundleServers(root: string, manifest?: Record<string, unknown>, variables?: BundleVariables) {
  const sources: unknown[] = [];
  if (await exists(path.join(root, ".mcp.json"))) sources.push(await json(await safePath(root, ".mcp.json")));
  const configured = manifest?.mcpServers;
  for (const value of configured === undefined ? [] : Array.isArray(configured) ? configured : [configured]) {
    if (typeof value === "string") {
      const file = await safePath(root, value);
      if (value.replace(/^\.\//, "") !== ".mcp.json") sources.push(await json(file));
    } else if (value && typeof value === "object" && !Array.isArray(value)) sources.push(value);
    else throw new Error("Invalid server component configuration.");
  }
  const servers: Record<string, BundleServer> = {};
  const issues: BundleIssue[] = [];
  for (const source of sources) {
    const object = record(source);
    for (const [name, value] of Object.entries(record(object.mcpServers ?? object.mcp_servers ?? object))) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("Invalid server identifier.");
        delete servers[name];
        servers[name] = { ...parseServer(value, variables), ...(record(value).capability === "computer" ? { capability: "computer" as const } : {}) };
      } catch (error) { issues.push({ component: `mcpServers/${name}`, detail: error instanceof Error ? error.message : String(error) }); }
    }
  }
  return { servers, issues };
}

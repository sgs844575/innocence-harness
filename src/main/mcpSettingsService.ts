import path from "node:path";
import { importMcpServers, listMcpServers, parseMcpImport, saveMcpServer } from "@innocenceharness/plugin-mcp/settings";
import type { McpSettingsApi } from "../shared/mcpSettingsIpc";
import { authorizeWorkspaceRoot } from "./mcpAuthorization";

export function createMcpSettingsService(getRoots: () => readonly string[], getUserRoot?: () => string): McpSettingsApi {
  const key = (root: string) => process.platform === "win32" ? root.toLowerCase() : root;
  const spaces = () => [...new Map(getRoots().filter((root) => root && path.isAbsolute(root)).map((root) => [key(path.resolve(root)), path.resolve(root)])).values()].map((root) => ({ root, name: path.basename(root) || root }));
  const authorize = async (root: string | null) => {
    if (root === null && getUserRoot) return { directory: getUserRoot() };
    if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("Unknown workspace.");
    const known = spaces().find((space) => key(space.root) === key(path.resolve(root)));
    if (!known) throw new Error("Unknown workspace.");
    return authorizeWorkspaceRoot(root, known.root);
  };
  return {
    async mcpSettingsWorkspaces() { return spaces(); },
    async mcpSettingsList(root) { return listMcpServers(await authorize(root)); },
    async mcpSettingsSave(root, name, entry, create) {
      if (typeof create !== "boolean") throw new Error("Invalid save operation.");
      await saveMcpServer(await authorize(root), name, entry, create);
    },
    async mcpSettingsImport(root, text) {
      const authorized = await authorize(root);
      const raw: unknown = JSON.parse(text);
      const parsed = parseMcpImport(JSON.stringify(raw && typeof raw === "object" && Object.hasOwn(raw, "mcpServers") ? raw : { mcpServers: raw }));
      return importMcpServers(parsed.servers, authorized, parsed.invalid);
    },
  };
}

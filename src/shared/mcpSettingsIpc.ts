import type { McpServerEntry } from "@innocenceharness/plugin-mcp/config";
import type { McpImportResult } from "@innocenceharness/plugin-mcp/settings";
export type { McpServerEntry };
export const McpSettingsChannels = {
  mcpSettingsWorkspaces: "mcp-settings:workspaces",
  mcpSettingsList: "mcp-settings:list",
  mcpSettingsSave: "mcp-settings:save",
  mcpSettingsImport: "mcp-settings:import",
} as const;
export interface McpSettingsApi {
  mcpSettingsWorkspaces(): Promise<{ root: string; name: string }[]>;
  mcpSettingsList(root: string | null): Promise<Record<string, McpServerEntry>>;
  mcpSettingsSave(root: string | null, name: string, entry: McpServerEntry | null, create: boolean): Promise<void>;
  mcpSettingsImport(root: string | null, text: string): Promise<McpImportResult>;
}

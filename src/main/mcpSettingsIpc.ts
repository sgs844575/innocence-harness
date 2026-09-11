import { appDataRoot } from "./appDataRoot";
import { ipcMain } from "electron";
import { McpSettingsChannels as channels } from "../shared/mcpSettingsIpc";
import { createMcpSettingsService } from "./mcpSettingsService";
import { getHarnessSettings } from "./harnessGlue";
import { listSessions } from "./sessions";

export function registerMcpSettingsIpc(): void {
  const service = createMcpSettingsService(() => [getHarnessSettings().workspaceRoot, ...listSessions().map((s) => s.workspaceRoot ?? "")], appDataRoot);
  ipcMain.handle(channels.mcpSettingsWorkspaces, () => service.mcpSettingsWorkspaces());
  ipcMain.handle(channels.mcpSettingsList, (_e, root) => service.mcpSettingsList(root));
  ipcMain.handle(channels.mcpSettingsSave, (_e, root, name, entry, create) => service.mcpSettingsSave(root, name, entry, create));
  ipcMain.handle(channels.mcpSettingsImport, (_e, root, text) => service.mcpSettingsImport(root, text));
}

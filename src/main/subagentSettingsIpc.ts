import { ipcMain } from "electron";
import { SubagentSettingsChannels as channels } from "../shared/subagentIpc";
import { createSubagentSettingsService } from "./subagentSettingsService";
import { appDataRoot } from "./appDataRoot";
import { listSessions } from "./sessions";
import { getHarnessSettings, getSubagentCatalog, refreshSubagentCatalog } from "./harnessGlue";

export function registerSubagentSettingsIpc(): void {
  const service = createSubagentSettingsService({
    getDataRoot: appDataRoot,
    getWorkspaceRoots: () => [getHarnessSettings().workspaceRoot, ...listSessions().map((s) => s.workspaceRoot ?? "")],
    loadCatalog: () => getSubagentCatalog(),
  });
  ipcMain.handle(channels.subagentWorkspaces, () => service.subagentWorkspaces());
  ipcMain.handle(channels.subagentCatalog, (_e, target) => service.subagentCatalog(target));
  ipcMain.handle(channels.subagentSave, async (_e, target, preset, create) => { await service.subagentSave(target, preset, create); refreshSubagentCatalog(); });
  ipcMain.handle(channels.subagentRemove, async (_e, target, id) => { await service.subagentRemove(target, id); refreshSubagentCatalog(); });
}

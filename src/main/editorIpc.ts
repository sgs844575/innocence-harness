import { app, ipcMain, shell } from "electron";
import { EditorIpcChannels } from "../shared/editorIpc";
import { discoverInstalledEditors } from "./editorDiscovery";
import { createEditorService } from "./editorService";
import { getHarnessSettings, setHarnessSettings } from "./harnessGlue";
import { getSession, listSessions } from "./sessions";

export function registerEditorIpc() {
  const service = createEditorService({
    discover: discoverInstalledEditors,
    getPreferences: getHarnessSettings,
    savePreferences: setHarnessSettings,
    getSessionRoot: (id) => getSession(id)?.workspaceRoot,
    getWorkspaceRoots: () => [getHarnessSettings().workspaceRoot, ...listSessions().map((session) => session.workspaceRoot ?? "")],
    getIcon: async (file) => (await app.getFileIcon(file, { size: "small" })).toDataURL(),
    openDirectory: async (root) => { const error = await shell.openPath(root); if (error) throw new Error(error); },
    revealFile: (file) => shell.showItemInFolder(file),
  });
  ipcMain.handle(EditorIpcChannels.editorsList, (_event, refresh) => service.editorsList(refresh === true));
  ipcMain.handle(EditorIpcChannels.editorsSelect, (_event, id) => service.editorsSelect(id));
  ipcMain.handle(EditorIpcChannels.editorOpenWorkspace, (_event, target) => service.editorOpenWorkspace(target));
  return service;
}

import { ipcMain, shell } from "electron";
import { MemoryIpcChannels } from "../shared/memoryIpc";
import { createMemoryService } from "./memoryService";
import { appDataRoot } from "./appDataRoot";
import { listSessions } from "./sessions";
import { getHarnessSettings, getMemoryFiles } from "./harnessGlue";

export function registerMemoryIpc(openEditorFile: (file: string) => Promise<void>): void {
  const service = createMemoryService({
    getDataRoot: appDataRoot,
    getWorkspaceRoots: () => [getHarnessSettings().workspaceRoot, ...listSessions().map((session) => session.workspaceRoot ?? "")],
    loadFiles: () => getMemoryFiles(),
    async openFile(file, action) {
      if (action === "reveal") { shell.showItemInFolder(file); return; }
      if (action === "editor") {
        await openEditorFile(file);
      } else {
        const error = await shell.openPath(file);
        if (error) throw new Error(error);
      }
    },
  });
  ipcMain.handle(MemoryIpcChannels.memoryWorkspaces, () => service.memoryWorkspaces());
  ipcMain.handle(MemoryIpcChannels.memoryFiles, (_e, target) => service.memoryFiles(target));
  ipcMain.handle(MemoryIpcChannels.memoryReadFile, (_e, target, name) => service.memoryReadFile(target, name));
  ipcMain.handle(MemoryIpcChannels.memoryOpenFile, (_e, target, name, action) => service.memoryOpenFile(target, name, action));
}

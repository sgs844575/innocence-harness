// 工作台 IPC：列表/新建/删除直通存储面；watch 管热刷新——fs.watch 递归监听
// 工作台目录，200ms 去抖后 touch 元数据并广播 workbench:changed（payload
// {id}）给全部存活窗口。watch 幂等、unwatch 释放；workbench.json 自身的写入
// 事件被忽略（防 touch 自激循环）。
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import { WorkbenchChannels as channels } from "../shared/workbenchIpc";
import { assertWorkbenchId, createWorkbench, listWorkbenches, removeWorkbench, touchWorkbench, workbenchRoot } from "./workbenchStore";

const DEBOUNCE_MS = 200;

/** 热刷新监听注册表（依赖注入便于测试：watch/touch/broadcast 全可替换）。 */
export function createWorkbenchWatchRegistry(deps: {
  dirFor(id: string): string;
  touch(id: string): Promise<void>;
  broadcast(id: string): void;
  debounceMs?: number;
  watchDir?(dir: string, listener: (filename: string | null) => void): { close(): void };
}): { watch(id: string): void; unwatch(id: string): void; dispose(): void; watched(): string[] } {
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;
  const watchDir = deps.watchDir ?? ((dir: string, listener: (filename: string | null) => void) =>
    fs.watch(dir, { recursive: true }, (_event, filename) => listener(filename)));
  const watchers = new Map<string, { watcher: { close(): void }; timer: NodeJS.Timeout | null }>();
  const unwatch = (id: string): void => {
    assertWorkbenchId(id);
    const entry = watchers.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
    watchers.delete(id);
  };
  return {
    watch(id: string): void {
      assertWorkbenchId(id);
      if (watchers.has(id)) return; // 幂等
      const watcher = watchDir(deps.dirFor(id), (filename) => {
        if (filename && path.basename(filename) === "workbench.json") return; // 元数据回写不算内容变更
        const entry = watchers.get(id);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          void deps.touch(id).catch(() => undefined);
          deps.broadcast(id);
        }, debounceMs);
      });
      watchers.set(id, { watcher, timer: null });
    },
    unwatch,
    dispose(): void {
      for (const id of [...watchers.keys()]) unwatch(id);
    },
    watched(): string[] {
      return [...watchers.keys()];
    },
  };
}

let registry: ReturnType<typeof createWorkbenchWatchRegistry> | undefined;

export function registerWorkbenchIpc(): void {
  const active = createWorkbenchWatchRegistry({
    dirFor: (id) => path.join(workbenchRoot(), id),
    touch: (id) => touchWorkbench(id),
    broadcast: (id) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channels.workbenchChanged, { id });
      }
    },
  });
  registry = active;
  ipcMain.handle(channels.workbenchList, () => listWorkbenches());
  ipcMain.handle(channels.workbenchCreate, (_e, name) => createWorkbench(name));
  ipcMain.handle(channels.workbenchRemove, (_e, id) => removeWorkbench(id));
  ipcMain.handle(channels.workbenchWatch, (_e, id) => active.watch(id));
  ipcMain.handle(channels.workbenchUnwatch, (_e, id) => active.unwatch(id));
}

/** 关机释放全部目录监听（幂等；由宿主 before-quit 管线调用）。 */
export function disposeWorkbenchWatchers(): void {
  registry?.dispose();
  registry = undefined;
}

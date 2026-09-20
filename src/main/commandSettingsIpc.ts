import path from "node:path";
import { app, ipcMain } from "electron";
import { createManagedCommand, listManagedCommands, removeManagedCommand } from "@innocenceharness/plugin-skills/commandManagement";
import { CommandSettingsChannels as channels, type CommandPluginGroup } from "../shared/commandSettingsIpc";
import { appDataRoot } from "./appDataRoot";
import { listSessions } from "./sessions";
import { bootPaths, getHarnessSettings, getPluginInventory } from "./harnessGlue";
import { discoverExternalCommands, importCommand } from "./commandDiscovery";
import { defaultUserPluginRoot } from "./pluginBoot/compose";
import { currentTestOverrides } from "./testOverrides";

/**
 * 设置页命令管理 IPC（扁平 *.md 命令；目录根解析与 skillSettingsIpc 同形：
 * null → 用户数据根 commands，项目根 → <root>/.innocence/commands，项目根
 * 必须在已知工作区集合内）。命令的运行时装载由 skills 插件的缺省四根承担
 * （sessionComposition），本模块只管设置面读写与外部导入。
 */
export function registerCommandSettingsIpc(): void {
  const root = (target: string | null) => {
    if (target === null) return path.join(appDataRoot(), "commands");
    const roots = [getHarnessSettings().workspaceRoot, ...listSessions().map((s) => s.workspaceRoot)];
    if (typeof target !== "string" || !roots.includes(target)) throw new Error("Unknown command workspace.");
    return path.join(target, ".innocence", "commands");
  };
  // 插件贡献分组：active 清单条目的磁盘目录（双根：用户插件根在前、内置
  // staging 根在后，与 resolver 根序一致）下的 commands/*.md。boot/staging
  // 不可用时整面降级为空分组，不阻断已安装命令的管理面。
  const pluginGroups = async (): Promise<CommandPluginGroup[]> => {
    const inventory = await getPluginInventory();
    const userRoot = currentTestOverrides(app.isPackaged).userPluginRoot ?? defaultUserPluginRoot();
    const builtinRoot = bootPaths().builtinRoot;
    const groups: CommandPluginGroup[] = [];
    for (const entry of inventory) {
      if (entry.state !== "active") continue;
      for (const dir of [path.join(userRoot, entry.id), path.join(builtinRoot, entry.id)]) {
        const commands = (await listManagedCommands(path.join(dir, "commands")))
          .map(({ name, description }) => ({ name, description }));
        if (commands.length > 0) {
          groups.push({ id: entry.id, title: entry.title, commands });
          break;
        }
      }
    }
    return groups;
  };
  const discover = async (target: string | null) => {
    const installed = await listManagedCommands(root(target));
    if (getHarnessSettings().externalSkillDiscovery === false) return [];
    const sources = await Promise.all([discoverExternalCommands(), ...(target === null ? [] : [discoverExternalCommands(target)])]);
    return [...new Map(sources.flat().map((command) => [command.sourceFile, command])).values()]
      .map((c) => ({ ...c, imported: installed.some((row) => row.id === c.name) }));
  };
  ipcMain.handle(channels.commandSettingsList, async (_e, target) => ({
    installed: await listManagedCommands(root(target)),
    plugins: await pluginGroups().catch(() => []),
  }));
  ipcMain.handle(channels.commandSettingsCreate, (_e, target, input) => {
    if (typeof input?.id !== "string" || typeof input?.description !== "string" || input.description.trim() === "" || typeof input?.body !== "string") {
      throw new Error("Invalid command definition.");
    }
    return createManagedCommand(root(target), input);
  });
  ipcMain.handle(channels.commandSettingsRemove, (_e, target, id) => removeManagedCommand(root(target), id));
  ipcMain.handle(channels.commandSettingsDiscover, (_e, target) => discover(target));
  ipcMain.handle(channels.commandSettingsImport, async (_e, target, sourceFile) => {
    if (typeof sourceFile !== "string") throw new Error("Invalid command source.");
    const command = (await discover(target)).find((c) => c.sourceFile === sourceFile && !c.imported);
    if (!command) throw new Error("Command source is unavailable or already imported.");
    await importCommand(command, root(target), target ?? undefined);
  });
}

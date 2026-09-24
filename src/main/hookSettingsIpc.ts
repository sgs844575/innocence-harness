import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, ipcMain } from "electron";
import { parseEcosystemHooksDocument, parseHookDefinitions, type HookDefinition } from "@innocenceharness/plugin-hooks";
import { HookSettingsChannels as channels, type HookListEntry, type HookPluginGroup } from "../shared/hookSettingsIpc";
import { listSessions } from "./sessions";
import { bootPaths, getHarnessSettings, getPluginInventory } from "./harnessGlue";
import { readHooksFile, writeHooksFile } from "./hookSettingsStore";
import { defaultUserPluginRoot } from "./pluginBoot/compose";
import { currentTestOverrides } from "./testOverrides";

/**
 * 设置页钩子管理 IPC：顶层 `hooks:` 声明的读写面。作用域解析与运行时读取
 * 面严格同径——用户层是 <home>/.innocence/cordis.yml（os.homedir()，组合
 * 根 compose.ts 的 loadConfigLayerPair 同参；注意不是 appDataRoot），项目
 * 层是 <root>/.innocence/plugins.yml（同样的工作区白名单校验）。创建只落
 * 五个已知字段的校验后投影；删除按原始数组下标；读不出的损坏文件直接抛错
 * （管理面不静默）。
 */
export function registerHookSettingsIpc(): void {
  const layerFile = (target: string | null) => {
    if (target === null) return path.join(os.homedir(), ".innocence", "cordis.yml");
    const roots = [getHarnessSettings().workspaceRoot, ...listSessions().map((s) => s.workspaceRoot)];
    if (typeof target !== "string" || !roots.includes(target)) throw new Error("Unknown hook workspace.");
    return path.join(target, ".innocence", "plugins.yml");
  };
  // 原始条目 → 清单行：能过校验的落投影字段；过不了的保留原始下标与可提取
  // 的回显字段，标 valid: false（用户可定位删除坏条目）。
  const project = (entry: unknown, index: number): HookListEntry => {
    const parsed = parseHookDefinitions([entry]);
    const hook = parsed.hooks[0];
    if (hook) return { index, valid: true, ...hook };
    const record = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    return {
      index,
      valid: false,
      event: typeof record.event === "string" ? record.event : "",
      command: typeof record.command === "string" ? record.command : "",
      warning: parsed.warnings[0] ?? "invalid hook entry",
    };
  };
  // 插件贡献分组：active 清单条目的磁盘目录（双根，与命令分组同序）下的
  // hooks/*.json，逐文件按生态文档解析；坏 JSON/坏条目降级跳过。
  const pluginGroups = async (): Promise<HookPluginGroup[]> => {
    const inventory = await getPluginInventory();
    const userRoot = currentTestOverrides(app.isPackaged).userPluginRoot ?? defaultUserPluginRoot();
    const builtinRoot = bootPaths().builtinRoot;
    const groups: HookPluginGroup[] = [];
    for (const entry of inventory) {
      if (entry.state !== "active") continue;
      for (const dir of [path.join(userRoot, entry.id), path.join(builtinRoot, entry.id)]) {
        const hooks = await scanPluginHooks(dir);
        if (hooks.length > 0) {
          groups.push({ id: entry.id, title: entry.title, hooks });
          break;
        }
      }
    }
    return groups;
  };
  ipcMain.handle(channels.hookSettingsList, async (_e, target) => ({
    installed: (await readHooksFile(layerFile(target))).map(project),
    plugins: await pluginGroups().catch(() => []),
  }));
  ipcMain.handle(channels.hookSettingsCreate, async (_e, target, input) => {
    const parsed = parseHookDefinitions([input]);
    const hook = parsed.hooks[0];
    if (!hook) throw new Error(parsed.warnings[0] ?? "Invalid hook definition.");
    const file = layerFile(target);
    const hooks = await readHooksFile(file);
    hooks.push(hook);
    await writeHooksFile(file, hooks);
  });
  ipcMain.handle(channels.hookSettingsRemove, async (_e, target, index) => {
    if (typeof index !== "number" || !Number.isInteger(index)) throw new Error("Invalid hook index.");
    const file = layerFile(target);
    const hooks = await readHooksFile(file);
    if (index < 0 || index >= hooks.length) throw new Error("Hook index out of range.");
    hooks.splice(index, 1);
    await writeHooksFile(file, hooks);
  });
}

async function scanPluginHooks(pluginRoot: string): Promise<HookDefinition[]> {
  const hooks: HookDefinition[] = [];
  const dir = path.join(pluginRoot, "hooks");
  for (const entry of (await fs.readdir(dir).catch(() => [] as string[])).sort()) {
    if (entry.startsWith(".") || !entry.endsWith(".json")) continue;
    const file = path.join(dir, entry);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue; // 坏 JSON 降级跳过，不拖垮整组
    }
    // 插件根随解析下发：命令里的插件根变量就地展开（与运行时装载同径）。
    hooks.push(...parseEcosystemHooksDocument(raw, { pluginRoot }).hooks);
  }
  return hooks;
}

import fs from "node:fs/promises";
import path from "node:path";
import { app, ipcMain } from "electron";
import { listManagedSkills, setSkillEnabled, removeManagedSkill, copyManagedSkill } from "@innocenceharness/plugin-skills/management";
import { parseSkillMarkdown } from "@innocenceharness/plugin-skills";
import { bundleManifest, componentFiles } from "@innocenceharness/harness-plugin-catalog";
import { SkillSettingsChannels as channels, type PluginSkillGroup } from "../shared/skillSettingsIpc";
import { appDataRoot } from "./appDataRoot";
import { listSessions } from "./sessions";
import { getHarnessSettings, getPluginInventory, bootPaths } from "./harnessGlue";
import { defaultUserPluginRoot } from "./pluginBoot/compose";
import { currentTestOverrides } from "./testOverrides";
import { discoverExternalSkills } from "./skillDiscovery";

export function registerSkillSettingsIpc(): void {
  const root = (target: string | null) => {
    if (target === null) return path.join(appDataRoot(), "skills");
    const roots = [getHarnessSettings().workspaceRoot, ...listSessions().map((s) => s.workspaceRoot)];
    if (typeof target !== "string" || !roots.includes(target)) throw new Error("Unknown skill workspace.");
    return path.join(target, ".innocence", "skills");
  };
  const discover = async (target: string | null) => {
    const installed = await listManagedSkills(root(target));
    if (getHarnessSettings().externalSkillDiscovery === false) return [];
    const sources = await Promise.all([discoverExternalSkills(), ...(target === null ? [] : [discoverExternalSkills(target)])]);
    return [...new Map(sources.flat().map((skill) => [skill.sourceDir, skill])).values()]
      .map((s) => ({ ...s, imported: installed.some((row) => row.id === s.name) }));
  };
  ipcMain.handle(channels.skillSettingsList, (_e, target) => listManagedSkills(root(target)));
  ipcMain.handle(channels.skillSettingsEnable, (_e, target, id, enabled) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid skill state.");
    return setSkillEnabled(root(target), id, enabled);
  });
  ipcMain.handle(channels.skillSettingsRemove, (_e, target, id) => removeManagedSkill(root(target), id));
  ipcMain.handle(channels.skillSettingsDiscover, (_e, target) => discover(target));
  ipcMain.handle(channels.skillSettingsImport, async (_e, target, source) => {
    const skill = (await discover(target)).find((s) => s.sourceDir === source && !s.imported);
    if (!skill) throw new Error("Skill source is unavailable or already imported.");
    await copyManagedSkill(root(target), skill.sourceDir, skill.name);
  });
  ipcMain.handle(channels.skillSettingsPlugins, () => pluginSkillGroups());
}

/** 插件贡献分组：激活清单条目（双根，与命令分组同序）的 skills/SKILL.md
 *  投影，按技能名排序。坏件/缺目录降级跳过，一条不拖垮整份清单。 */
async function pluginSkillGroups(): Promise<PluginSkillGroup[]> {
  const inventory = await getPluginInventory();
  const userRoot = currentTestOverrides(app.isPackaged).userPluginRoot ?? defaultUserPluginRoot();
  const builtinRoot = bootPaths().builtinRoot;
  const groups: PluginSkillGroup[] = [];
  for (const entry of inventory) {
    if (entry.state !== "active") continue;
    for (const dir of [path.join(userRoot, entry.id), path.join(builtinRoot, entry.id)]) {
      const skills = await scanPluginSkillGroup(dir);
      if (skills.length > 0) {
        groups.push({ id: entry.id, title: entry.title, skills });
        break;
      }
    }
  }
  return groups;
}

/**
 * 单个 bundle 布局插件的技能贡献：skills 目录下各 SKILL.md 的 frontmatter
 * 投影。native 布局插件的程序化注册技能是运行时行为，静态清单不覆盖（与
 * 运行时装载边界一致）；目录缺失返回空。
 */
async function scanPluginSkillGroup(root: string): Promise<{ name: string; description: string }[]> {
  const skills: { name: string; description: string }[] = [];
  const manifest = await bundleManifest(root);
  for (const rel of await componentFiles(root, "skills", manifest)) {
    const raw = await fs.readFile(path.join(root, rel), "utf8").catch(() => null);
    if (raw === null) continue;
    const parsed = parseSkillMarkdown(raw);
    if (parsed) skills.push({ name: parsed.name, description: parsed.description });
  }
  return skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

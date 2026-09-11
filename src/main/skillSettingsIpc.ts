import path from "node:path";
import { ipcMain } from "electron";
import { listManagedSkills, setSkillEnabled, removeManagedSkill, copyManagedSkill } from "@innocenceharness/plugin-skills/management";
import { SkillSettingsChannels as channels } from "../shared/skillSettingsIpc";
import { appDataRoot } from "./appDataRoot";
import { listSessions } from "./sessions";
import { getHarnessSettings } from "./harnessGlue";
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
}

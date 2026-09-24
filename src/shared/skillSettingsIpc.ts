import type { ManagedSkill } from "@innocenceharness/plugin-skills/management";
import type { DiscoveredSkillMirror } from "./ipc";
export type { ManagedSkill };
/** 设置页技能清单中"插件贡献"分组的投影（组标题 = 插件展示名）：只读展示，
 *  技能在会话组装时由生态适配器注册，不落受管理根，故无开关/删除面。 */
export interface PluginSkillGroup {
  id: string;
  title: string;
  skills: { name: string; description: string }[];
}
export interface SkillSettingsApi {
  skillSettingsList(target: string | null): Promise<ManagedSkill[]>;
  skillSettingsEnable(target: string | null, id: string, enabled: boolean): Promise<void>;
  skillSettingsRemove(target: string | null, id: string): Promise<void>;
  skillSettingsDiscover(target: string | null): Promise<DiscoveredSkillMirror[]>;
  skillSettingsImport(target: string | null, source: string): Promise<void>;
  /** 插件贡献技能分组（与作用域无关的全局清单；target 仅保持签名对称）。 */
  skillSettingsPlugins(target: string | null): Promise<PluginSkillGroup[]>;
}
export const SkillSettingsChannels = {
  skillSettingsList: "skill-settings:list", skillSettingsEnable: "skill-settings:enable",
  skillSettingsRemove: "skill-settings:remove", skillSettingsDiscover: "skill-settings:discover", skillSettingsImport: "skill-settings:import",
  skillSettingsPlugins: "skill-settings:plugins",
} as const;

import type { ManagedSkill } from "@innocenceharness/plugin-skills/management";
import type { DiscoveredSkillMirror } from "./ipc";
export type { ManagedSkill };
export interface SkillSettingsApi {
  skillSettingsList(target: string | null): Promise<ManagedSkill[]>;
  skillSettingsEnable(target: string | null, id: string, enabled: boolean): Promise<void>;
  skillSettingsRemove(target: string | null, id: string): Promise<void>;
  skillSettingsDiscover(target: string | null): Promise<DiscoveredSkillMirror[]>;
  skillSettingsImport(target: string | null, source: string): Promise<void>;
}
export const SkillSettingsChannels = {
  skillSettingsList: "skill-settings:list", skillSettingsEnable: "skill-settings:enable",
  skillSettingsRemove: "skill-settings:remove", skillSettingsDiscover: "skill-settings:discover", skillSettingsImport: "skill-settings:import",
} as const;

import type { ManagedCommand } from "@innocenceharness/plugin-skills/commandManagement";
export type { ManagedCommand };
/** 设置页命令清单中"插件贡献"分组的投影（组标题 = 插件展示名）。 */
export interface CommandPluginGroup {
  id: string;
  title: string;
  commands: { name: string; description: string }[];
}
export interface CommandListResult {
  installed: ManagedCommand[];
  plugins: CommandPluginGroup[];
}
// 镜像契约：以下发现 DTO 复制自 src/main/commandDiscovery.ts 的
// DiscoveredCommand（shared 不 import main），修改任何一侧时必须同步另一侧。
/** 外部命令发现清单的一条条目（IPC command-settings:discover 载荷）。 */
export interface DiscoveredCommandMirror {
  name: string;
  description: string;
  sourceFile: string;
  origin: string;
  imported: boolean;
}
export interface CommandSettingsApi {
  commandSettingsList(target: string | null): Promise<CommandListResult>;
  commandSettingsCreate(target: string | null, input: { id: string; description: string; body: string }): Promise<void>;
  commandSettingsRemove(target: string | null, id: string): Promise<void>;
  commandSettingsDiscover(target: string | null): Promise<DiscoveredCommandMirror[]>;
  commandSettingsImport(target: string | null, sourceFile: string): Promise<void>;
}
export const CommandSettingsChannels = {
  commandSettingsList: "command-settings:list", commandSettingsCreate: "command-settings:create",
  commandSettingsRemove: "command-settings:remove", commandSettingsDiscover: "command-settings:discover", commandSettingsImport: "command-settings:import",
} as const;

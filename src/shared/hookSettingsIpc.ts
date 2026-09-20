import type { HookDefinition } from "@innocenceharness/plugin-hooks";
export type { HookDefinition };
// 镜像契约：与 packages/plugin-hooks/src/config.ts 的 HOOK_EVENTS 同步
// （渲染层不装载插件包运行时，事件 id 列表在此手工镜像；校验的权威面仍是
// main 侧的 parseHookDefinitions）。
export const HOOK_EVENT_IDS = ["userPromptSubmit", "preToolCall", "postToolCall", "sessionStart", "sessionStop", "turnEnd"] as const;
/**
 * 设置页钩子清单的一条已安装条目（IPC hook-settings:list 载荷）：index 是
 * 层文件 `hooks:` 数组中的原始下标（删除按它定位）；校验失败的原始条目照常
 * 列出（valid: false + 首个解析告警 + 可提取的 event/command 原文回显），
 * 以便用户能删掉坏条目。
 */
export interface HookListEntry {
  index: number;
  valid: boolean;
  event: string;
  command: string;
  match?: string;
  timeoutMs?: number;
  condition?: string;
  warning?: string;
}
/** 设置页钩子清单中"插件贡献"分组的投影（组标题 = 插件展示名）。 */
export interface HookPluginGroup {
  id: string;
  title: string;
  hooks: HookDefinition[];
}
export interface HookListResult {
  installed: HookListEntry[];
  plugins: HookPluginGroup[];
}
export interface HookSettingsApi {
  hookSettingsList(target: string | null): Promise<HookListResult>;
  hookSettingsCreate(target: string | null, hook: HookDefinition): Promise<void>;
  hookSettingsRemove(target: string | null, index: number): Promise<void>;
}
export const HookSettingsChannels = {
  hookSettingsList: "hook-settings:list", hookSettingsCreate: "hook-settings:create",
  hookSettingsRemove: "hook-settings:remove",
} as const;

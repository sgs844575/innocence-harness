import type { CatalogPreset, SavedPreset } from "@innocenceharness/plugin-subagent";
export type { CatalogPreset, SavedPreset };
export const SubagentSettingsChannels = {
  subagentWorkspaces: "subagent-settings:workspaces",
  subagentCatalog: "subagent-settings:catalog",
  subagentSave: "subagent-settings:save",
  subagentRemove: "subagent-settings:remove",
} as const;
export interface SubagentSettingsApi {
  subagentWorkspaces(): Promise<{ root: string; name: string }[]>;
  subagentCatalog(target: string | null): Promise<CatalogPreset[]>;
  subagentSave(target: string | null, preset: SavedPreset, create: boolean): Promise<void>;
  subagentRemove(target: string | null, id: string): Promise<void>;
}

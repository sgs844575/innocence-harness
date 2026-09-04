import type { HarnessSettings as DomainSettings } from "@innocenceharness/harness-electron";
import type { HarnessSettings as SettingsMirror } from "../shared/ipc";

export function toSettingsMirror(settings: DomainSettings): SettingsMirror {
  return structuredClone(settings);
}

export function toPersistedSettings(settings: DomainSettings): DomainSettings {
  return structuredClone(settings);
}

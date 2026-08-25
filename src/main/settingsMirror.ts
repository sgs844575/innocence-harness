import type { HarnessSettings as DomainSettings } from "@innocenceharness/harness-electron";
import type { HarnessSettings as SettingsMirror } from "../shared/ipc";

/** Removes credentials before settings cross the host-to-renderer boundary. */
export function toSettingsMirror(settings: DomainSettings): SettingsMirror {
  return {
    ...settings,
    profiles: settings.profiles.map(({ apiKey, ...profile }) => ({
      ...profile,
      apiKey: "",
      apiKeyConfigured: Boolean(apiKey || profile.apiKeyRef),
    })),
  };
}

/** Removes credentials before settings are serialized to the regular settings file. */
export function toPersistedSettings(settings: DomainSettings): DomainSettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => ({ ...profile, apiKey: "" })),
  };
}

import { mergeSettings, type HarnessSettings, type ProviderProfile } from "@innocenceharness/harness-electron";
import type { ProviderProfile as MirroredProfile } from "../shared/ipc";
import type { HarnessSettingsPatch } from "../shared/settingsPatch";

function withoutRendererCredentialFields(profile: Partial<MirroredProfile>): Partial<ProviderProfile> {
  const { apiKey: _apiKey, apiKeyConfigured: _apiKeyConfigured, ...safe } = profile;
  return safe;
}

/** Applies a renderer mutation to the settings value committed immediately before it. */
export function applySettingsPatch(
  current: HarnessSettings,
  patch: HarnessSettingsPatch,
): HarnessSettings {
  const { providerProfiles, pluginToggleChanges, ...fields } = patch;
  const mergedFields = pluginToggleChanges
    ? { ...fields, pluginToggles: { ...(current.pluginToggles ?? {}), ...pluginToggleChanges } }
    : fields;
  let profiles = [...current.profiles];

  if (providerProfiles) {
    const removed = new Set(providerProfiles.removeIds);
    profiles = profiles.filter((profile) => !removed.has(profile.id));
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    for (const mutation of providerProfiles.updates ?? []) {
      if (removed.has(mutation.id)) continue;
      const existing = byId.get(mutation.id);
      if (existing && mutation.changes) {
        byId.set(mutation.id, { ...existing, ...withoutRendererCredentialFields(mutation.changes) });
      } else if (!existing && mutation.create) {
        const created = withoutRendererCredentialFields(mutation.create) as ProviderProfile;
        byId.set(mutation.id, { ...created, apiKey: "" });
      }
    }
    profiles = profiles.map((profile) => byId.get(profile.id) ?? profile);
    for (const mutation of providerProfiles.updates ?? []) {
      const profile = byId.get(mutation.id);
      if (profile && !profiles.some((candidate) => candidate.id === mutation.id)) profiles.push(profile);
    }
    if (providerProfiles.order) {
      const ordered = providerProfiles.order
        .map((id) => byId.get(id))
        .filter((profile): profile is ProviderProfile => profile !== undefined);
      const orderedIds = new Set(ordered.map((profile) => profile.id));
      profiles = [...ordered, ...profiles.filter((profile) => !orderedIds.has(profile.id))];
    }
  }

  return mergeSettings({ ...current, ...mergedFields, profiles });
}

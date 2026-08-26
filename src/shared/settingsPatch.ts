import type { HarnessSettings, ProviderProfile } from "./ipc";

/** Rebasable profile-level mutations. `create` is used only for a new id. */
export interface ProviderProfileMutation {
  id: string;
  changes?: Partial<ProviderProfile>;
  create?: ProviderProfile;
}

export interface ProviderProfilesMutation {
  updates?: ProviderProfileMutation[];
  removeIds?: string[];
  /** Explicit UI ordering for profiles that still exist after updates/removals. */
  order?: string[];
}

/** A host-rebasable settings mutation. Omitted fields preserve latest committed values. */
export type HarnessSettingsPatch = Partial<Omit<HarnessSettings, "profiles">> & {
  providerProfiles?: ProviderProfilesMutation;
};

function profileChanges(previous: ProviderProfile, next: ProviderProfile): Partial<ProviderProfile> | undefined {
  const changes: Partial<ProviderProfile> = {};
  for (const key of Object.keys(next) as (keyof ProviderProfile)[]) {
    if (key === "apiKey" || key === "apiKeyConfigured" || Object.is(previous[key], next[key])) continue;
    changes[key] = next[key] as never;
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}

/** Turns a renderer snapshot into a mutation which can be rebased by the host. */
export function diffSettingsSnapshot(
  current: HarnessSettings,
  next: HarnessSettings,
): HarnessSettingsPatch {
  const patch: HarnessSettingsPatch = {};
  for (const key of Object.keys(next)) {
    if (key === "profiles") continue;
    const settingsKey = key as keyof Omit<HarnessSettings, "profiles">;
    if (!Object.is(current[settingsKey], next[settingsKey])) {
      patch[settingsKey] = next[settingsKey] as never;
    }
  }

  const currentById = new Map(current.profiles.map((profile) => [profile.id, profile]));
  const nextById = new Map(next.profiles.map((profile) => [profile.id, profile]));
  const updates: ProviderProfileMutation[] = [];
  for (const profile of next.profiles) {
    const previous = currentById.get(profile.id);
    if (!previous) {
      updates.push({ id: profile.id, create: profile });
    } else {
      const changes = profileChanges(previous, profile);
      if (changes) updates.push({ id: profile.id, changes });
    }
  }
  const removeIds = current.profiles.filter((profile) => !nextById.has(profile.id)).map((profile) => profile.id);
  const order = next.profiles.map((profile) => profile.id);
  const orderChanged = !current.profiles.every((profile, index) => profile.id === order[index]) ||
    current.profiles.length !== order.length;
  const profiles: ProviderProfilesMutation | undefined = updates.length || removeIds.length || orderChanged
    ? { updates, removeIds, order }
    : undefined;
  if (profiles) patch.providerProfiles = profiles;
  return patch;
}

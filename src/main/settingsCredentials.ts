import type { HarnessSettings, ProviderProfile } from "@innocenceharness/harness-electron";

export interface CredentialStorePort {
  read(ref: string): Promise<string>;
  write(profileId: string, value: string): Promise<string>;
  delete(ref: string): Promise<void>;
}

export interface HydratedCredentials {
  settings: HarnessSettings;
  migrated: boolean;
  errors: string[];
  createdRefs: string[];
  obsoleteRefs: string[];
}

export type DurableSettingsCommit = (settings: HarnessSettings) => Promise<void>;

function withoutRendererOnlyFields(profile: ProviderProfile): ProviderProfile {
  const { apiKeyConfigured: _apiKeyConfigured, ...settingsProfile } = profile as ProviderProfile & { apiKeyConfigured?: boolean };
  return settingsProfile;
}

/** Resolves secured credentials only in the main-process settings view. */
export async function hydrateCredentials(
  settings: HarnessSettings,
  store: CredentialStorePort,
): Promise<HydratedCredentials> {
  let migrated = false;
  const errors: string[] = [];
  const createdRefs: string[] = [];
  const obsoleteRefs: string[] = [];
  const profiles = await Promise.all(settings.profiles.map(async (rawProfile) => {
    const profile = withoutRendererOnlyFields(rawProfile);
    if (profile.apiKeyRef) {
      try {
        const apiKey = await store.read(profile.apiKeyRef);
        if (profile.apiKey) migrated = true;
        return { ...profile, apiKey };
      } catch {
        // A legacy plaintext fallback remains usable, but the stale reference
        // must not survive in the active projection or mirror.
        if (profile.apiKey) {
          try {
            const apiKeyRef = await store.write(profile.id, profile.apiKey);
            createdRefs.push(apiKeyRef);
            obsoleteRefs.push(profile.apiKeyRef);
            migrated = true;
            return { ...profile, apiKeyRef };
          } catch {
            errors.push("credential migration failed");
            return { ...profile, apiKeyRef: undefined };
          }
        }
        migrated = true;
        obsoleteRefs.push(profile.apiKeyRef);
        return { ...profile, apiKey: "", apiKeyRef: undefined };
      }
    }
    if (!profile.apiKey) return profile;
    try {
      const apiKeyRef = await store.write(profile.id, profile.apiKey);
      createdRefs.push(apiKeyRef);
      migrated = true;
      return { ...profile, apiKeyRef };
    } catch {
      errors.push("credential migration failed");
      return profile;
    }
  }));
  return {
    settings: { ...settings, profiles },
    migrated,
    errors: [...new Set(errors)],
    createdRefs,
    obsoleteRefs,
  };
}

/** Preserves host-held credentials across redacted renderer settings updates. */
export async function secureSettingsUpdate(
  previous: HarnessSettings,
  next: HarnessSettings,
  store: CredentialStorePort,
  commit: DurableSettingsCommit = async () => undefined,
): Promise<HarnessSettings> {
  const priorById = new Map(previous.profiles.map((profile) => [profile.id, profile]));
  const createdRefs: string[] = [];
  const profiles: ProviderProfile[] = [];
  try {
    for (const rawProfile of next.profiles) {
      const profile = withoutRendererOnlyFields(rawProfile);
      const prior = priorById.get(profile.id);
      const incomingKey = (profile.apiKey ?? "").trim();
      if (!incomingKey) {
        profiles.push(prior
          ? { ...profile, apiKey: prior.apiKey, apiKeyRef: prior.apiKeyRef }
          : { ...profile, apiKeyRef: undefined });
        continue;
      }
      if (prior?.apiKey === incomingKey && prior.apiKeyRef) {
        profiles.push({ ...profile, apiKey: incomingKey, apiKeyRef: prior.apiKeyRef });
        continue;
      }
      const apiKeyRef = await store.write(profile.id, incomingKey);
      createdRefs.push(apiKeyRef);
      profiles.push({ ...profile, apiKey: incomingKey, apiKeyRef });
    }

    const candidate = { ...next, profiles };
    await commit(candidate);

    const retained = new Set(profiles.map((profile) => profile.id));
    const oldRefs = previous.profiles
      .filter((profile) => !retained.has(profile.id) || profiles.some((nextProfile) =>
        nextProfile.id === profile.id && nextProfile.apiKeyRef !== profile.apiKeyRef))
      .map((profile) => profile.apiKeyRef)
      .filter((ref): ref is string => Boolean(ref));
    await Promise.all(oldRefs.map(async (ref) => {
      try { await store.delete(ref); } catch { /* committed settings remain authoritative */ }
    }));
    return candidate;
  } catch (error) {
    await Promise.all(createdRefs.map(async (ref) => {
      try { await store.delete(ref); } catch { /* best-effort rollback */ }
    }));
    throw error;
  }
}

/** Replaces or clears one host-owned profile credential. */
export async function setProfileCredential(
  settings: HarnessSettings,
  profileId: string,
  value: string,
  store: CredentialStorePort,
  commit: DurableSettingsCommit = async () => undefined,
): Promise<HarnessSettings> {
  const profile = settings.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error("profile not found");
  const apiKey = value.trim();
  let apiKeyRef: string | undefined;
  let createdRef: string | undefined;
  try {
    if (apiKey) {
      apiKeyRef = await store.write(profile.id, apiKey);
      createdRef = apiKeyRef;
    }
    const candidate = {
      ...settings,
      profiles: settings.profiles.map((candidateProfile) =>
        candidateProfile.id === profileId ? { ...candidateProfile, apiKey, apiKeyRef } : candidateProfile,
      ),
    };
    await commit(candidate);
    if (profile.apiKeyRef && profile.apiKeyRef !== apiKeyRef) {
      try { await store.delete(profile.apiKeyRef); } catch { /* committed settings remain authoritative */ }
    }
    return candidate;
  } catch (error) {
    if (createdRef) {
      try { await store.delete(createdRef); } catch { /* best-effort rollback */ }
    }
    throw error;
  }
}

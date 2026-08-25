import type { HarnessSettings, ProviderProfile } from "@innocenceharness/harness-electron";

export interface CredentialStorePort {
  read(ref: string): Promise<string>;
  write(profileId: string, value: string): Promise<string>;
  delete(ref: string): Promise<void>;
}

export interface HydratedCredentials {
  settings: HarnessSettings;
  migrated: boolean;
}

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
  const profiles = await Promise.all(settings.profiles.map(async (rawProfile) => {
    const profile = withoutRendererOnlyFields(rawProfile);
    if (profile.apiKeyRef) {
      try {
        const apiKey = await store.read(profile.apiKeyRef);
        if (profile.apiKey) migrated = true;
        return { ...profile, apiKey };
      } catch {
        // Old settings can contain a plaintext fallback beside a stale reference.
        if (!profile.apiKey) return { ...profile, apiKey: "" };
        const apiKeyRef = await store.write(profile.id, profile.apiKey);
        migrated = true;
        return { ...profile, apiKeyRef };
      }
    }
    if (!profile.apiKey) return profile;
    const apiKeyRef = await store.write(profile.id, profile.apiKey);
    migrated = true;
    return { ...profile, apiKeyRef };
  }));
  return { settings: { ...settings, profiles }, migrated };
}

/** Preserves host-held credentials across redacted renderer settings updates. */
export async function secureSettingsUpdate(
  previous: HarnessSettings,
  next: HarnessSettings,
  store: CredentialStorePort,
): Promise<HarnessSettings> {
  const priorById = new Map(previous.profiles.map((profile) => [profile.id, profile]));
  const profiles = await Promise.all(next.profiles.map(async (rawProfile) => {
    const profile = withoutRendererOnlyFields(rawProfile);
    const prior = priorById.get(profile.id);
    const incomingKey = profile.apiKey.trim();
    if (!incomingKey) {
      return prior
        ? { ...profile, apiKey: prior.apiKey, apiKeyRef: prior.apiKeyRef }
        : { ...profile, apiKeyRef: undefined };
    }
    if (prior?.apiKey === incomingKey && prior.apiKeyRef) {
      return { ...profile, apiKey: incomingKey, apiKeyRef: prior.apiKeyRef };
    }
    const apiKeyRef = await store.write(profile.id, incomingKey);
    if (prior?.apiKeyRef && prior.apiKeyRef !== apiKeyRef) await store.delete(prior.apiKeyRef);
    return { ...profile, apiKey: incomingKey, apiKeyRef };
  }));
  const remaining = new Set(profiles.map((profile) => profile.id));
  await Promise.all(previous.profiles
    .filter((profile) => !remaining.has(profile.id) && profile.apiKeyRef)
    .map((profile) => store.delete(profile.apiKeyRef!)));
  return { ...next, profiles };
}

/** Replaces or clears one host-owned profile credential. */
export async function setProfileCredential(
  settings: HarnessSettings,
  profileId: string,
  value: string,
  store: CredentialStorePort,
): Promise<HarnessSettings> {
  const profile = settings.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error("profile not found");
  const apiKey = value.trim();
  let apiKeyRef: string | undefined;
  if (apiKey) {
    apiKeyRef = await store.write(profile.id, apiKey);
  }
  if (profile.apiKeyRef && profile.apiKeyRef !== apiKeyRef) await store.delete(profile.apiKeyRef);
  return {
    ...settings,
    profiles: settings.profiles.map((candidate) =>
      candidate.id === profileId ? { ...candidate, apiKey, apiKeyRef } : candidate,
    ),
  };
}

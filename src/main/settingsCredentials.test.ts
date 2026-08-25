import { describe, expect, it, vi } from "vitest";
import type { HarnessSettings } from "@innocenceharness/harness-electron";
import { hydrateCredentials, secureSettingsUpdate, setProfileCredential, type CredentialStorePort } from "./settingsCredentials";

const base = (profile: Partial<HarnessSettings["profiles"][number]> = {}): HarnessSettings => ({
  profiles: [{
    id: "p1", name: "Provider", kind: "openai", apiKey: "", baseURL: "", enabled: true,
    models: [{ id: "m1", source: "manual" }], ...profile,
  }],
  activeProfileId: "p1", activeModel: "m1", workspaceRoot: "", permissionMode: "ask",
});

describe("settings credential coordination", () => {
  it("migrates legacy plaintext credentials to a secure reference", async () => {
    const store: CredentialStorePort = { read: vi.fn(), write: vi.fn().mockResolvedValue("keys/p1.key"), delete: vi.fn() };
    const result = await hydrateCredentials(base({ apiKey: "old-key" }), store);

    expect(store.write).toHaveBeenCalledWith("p1", "old-key");
    expect(result.migrated).toBe(true);
    expect(result.settings.profiles[0]).toMatchObject({ apiKey: "old-key", apiKeyRef: "keys/p1.key" });
  });

  it("restores a referenced credential for the host runtime", async () => {
    const store: CredentialStorePort = { read: vi.fn().mockResolvedValue("stored-key"), write: vi.fn(), delete: vi.fn() };
    const result = await hydrateCredentials(base({ apiKeyRef: "keys/p1.key" }), store);

    expect(store.read).toHaveBeenCalledWith("keys/p1.key");
    expect(result.settings.profiles[0]?.apiKey).toBe("stored-key");
    expect(result.migrated).toBe(false);
  });

  it("marks a readable reference with residual plaintext for rewrite", async () => {
    const store: CredentialStorePort = { read: vi.fn().mockResolvedValue("stored-key"), write: vi.fn(), delete: vi.fn() };
    const result = await hydrateCredentials(base({ apiKey: "old-key", apiKeyRef: "keys/p1.key" }), store);

    expect(result.settings.profiles[0]?.apiKey).toBe("stored-key");
    expect(result.migrated).toBe(true);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("migrates a legacy key when its stale secure reference cannot be read", async () => {
    const store: CredentialStorePort = {
      read: vi.fn().mockRejectedValue(new Error("missing")),
      write: vi.fn().mockResolvedValue("keys/p2.key"),
      delete: vi.fn(),
    };
    const result = await hydrateCredentials(base({ apiKey: "legacy-key", apiKeyRef: "keys/p1.key" }), store);

    expect(store.write).toHaveBeenCalledWith("p1", "legacy-key");
    expect(result.settings.profiles[0]).toMatchObject({ apiKey: "legacy-key", apiKeyRef: "keys/p2.key" });
    expect(result.migrated).toBe(true);
  });

  it("keeps an existing credential when a redacted settings update has no key", async () => {
    const store: CredentialStorePort = { read: vi.fn(), write: vi.fn(), delete: vi.fn() };
    const previous = base({ apiKey: "stored-key", apiKeyRef: "keys/p1.key" });
    const result = await secureSettingsUpdate(previous, base(), store);

    expect(result.profiles[0]).toMatchObject({ apiKey: "stored-key", apiKeyRef: "keys/p1.key" });
    expect(store.write).not.toHaveBeenCalled();
  });

  it("stores a replacement credential then deletes the previous reference", async () => {
    const store: CredentialStorePort = { read: vi.fn(), write: vi.fn().mockResolvedValue("keys/p2.key"), delete: vi.fn() };
    const previous = base({ apiKey: "old-key", apiKeyRef: "keys/p1.key" });
    const result = await secureSettingsUpdate(previous, base({ apiKey: "new-key" }), store);

    expect(result.profiles[0]).toMatchObject({ apiKey: "new-key", apiKeyRef: "keys/p2.key" });
    expect(store.write).toHaveBeenCalledWith("p1", "new-key");
    expect(store.delete).toHaveBeenCalledWith("keys/p1.key");
  });

  it("deletes references for removed profiles", async () => {
    const store: CredentialStorePort = { read: vi.fn(), write: vi.fn(), delete: vi.fn() };
    await secureSettingsUpdate(base({ apiKey: "old-key", apiKeyRef: "keys/p1.key" }), { ...base(), profiles: [] }, store);
    expect(store.delete).toHaveBeenCalledWith("keys/p1.key");
  });

  it("updates and clears a single profile credential without returning its value", async () => {
    const store: CredentialStorePort = { read: vi.fn(), write: vi.fn().mockResolvedValue("keys/p2.key"), delete: vi.fn() };
    const updated = await setProfileCredential(base({ apiKey: "old-key", apiKeyRef: "keys/p1.key" }), "p1", "new-key", store);
    expect(updated.profiles[0]).toMatchObject({ apiKey: "new-key", apiKeyRef: "keys/p2.key" });
    expect(store.delete).toHaveBeenCalledWith("keys/p1.key");

    const cleared = await setProfileCredential(updated, "p1", "", store);
    expect(cleared.profiles[0]).toMatchObject({ apiKey: "", apiKeyRef: undefined });
    expect(store.delete).toHaveBeenCalledWith("keys/p2.key");
  });
});

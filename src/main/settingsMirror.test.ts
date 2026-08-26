import { describe, expect, it } from "vitest";
import { toPersistedSettings, toSettingsMirror } from "./settingsMirror";

describe("settings mirror", () => {
  it("does not treat a stale reference without a hydrated key as configured", () => {
    const mirror = toSettingsMirror({
      profiles: [{
        id: "p1", name: "Stale", kind: "google", apiKey: "", apiKeyRef: "keys/stale.key",
        baseURL: "", enabled: true, models: [{ id: "m1", source: "manual" }],
      }],
      activeProfileId: "p1", activeModel: "m1", workspaceRoot: "", permissionMode: "ask",
    });

    expect(mirror.profiles[0]).toMatchObject({ apiKey: "", apiKeyConfigured: false });
  });

  it("redacts plaintext provider credentials while keeping configuration state", () => {
    const source = {
      profiles: [{
        id: "p1", name: "Configured", kind: "google" as const, apiKey: "top-secret", apiKeyRef: "keys/key-1",
        baseURL: "", enabled: true, models: [{ id: "m1", source: "manual" as const }],
      }],
      activeProfileId: "p1", activeModel: "m1", workspaceRoot: "", permissionMode: "ask" as const,
    };
    const mirror = toSettingsMirror(source);

    expect(JSON.stringify(mirror)).not.toContain("top-secret");
    expect(mirror.profiles[0]).toMatchObject({ apiKey: "", apiKeyRef: "keys/key-1", apiKeyConfigured: true });
    expect(toPersistedSettings(source).profiles[0]).toEqual(expect.objectContaining({ apiKey: "", apiKeyRef: "keys/key-1" }));
    expect(JSON.stringify(toPersistedSettings(source))).not.toContain("top-secret");
  });
});

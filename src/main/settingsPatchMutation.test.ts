import { describe, expect, it } from "vitest";
import type { HarnessSettings } from "@innocenceharness/harness-electron";
import { applySettingsPatch } from "./settingsPatchMutation";
import { createSettingsMutationGate } from "./settingsMutationGate";
import { diffSettingsSnapshot } from "../shared/settingsPatch";

const settings = (): HarnessSettings => ({
  profiles: [
    { id: "p1", name: "One", kind: "openai", apiKey: "one", baseURL: "", enabled: true, models: [{ id: "m1", source: "manual" }] },
    { id: "p2", name: "Two", kind: "openai", apiKey: "two", baseURL: "", enabled: true, models: [{ id: "m2", source: "manual" }] },
  ],
  activeProfileId: "p1", activeModel: "m1", workspaceRoot: "", permissionMode: "ask",
});

describe("settings patch mutation", () => {
  it("rebases independent stale profile patches on the latest committed state", () => {
    const first = applySettingsPatch(settings(), {
      providerProfiles: { updates: [{ id: "p1", changes: { name: "Renamed" } }] },
    });
    const second = applySettingsPatch(first, {
      providerProfiles: { updates: [{ id: "p2", changes: { baseURL: "https://example.invalid" } }] },
    });

    expect(second.profiles.find((profile) => profile.id === "p1")?.name).toBe("Renamed");
    expect(second.profiles.find((profile) => profile.id === "p2")?.baseURL).toBe("https://example.invalid");
  });

  it("keeps profiles added by a prior committed mutation when applying stale order", () => {
    const withAdded = applySettingsPatch(settings(), {
      providerProfiles: { updates: [{
        id: "p3",
        create: { id: "p3", name: "Three", kind: "google", apiKey: "", baseURL: "", enabled: true, models: [] },
      }] },
    });
    const rebased = applySettingsPatch(withAdded, {
      providerProfiles: { order: ["p2", "p1"] },
    });

    expect(rebased.profiles.map((profile) => profile.id)).toEqual(["p2", "p1", "p3"]);
  });

  it("preserves independent plugin toggles from the same stale renderer snapshot", async () => {
    const current: HarnessSettings = { ...settings(), pluginToggles: { first: true, second: true } };
    const firstSnapshot: HarnessSettings = { ...current, pluginToggles: { first: false, second: true } };
    const secondSnapshot: HarnessSettings = { ...current, pluginToggles: { first: true, second: false } };
    const gate = createSettingsMutationGate();
    let committed: HarnessSettings = current;

    const firstPatch = diffSettingsSnapshot(current, firstSnapshot);
    const secondPatch = diffSettingsSnapshot(current, secondSnapshot);
    expect(firstPatch).toMatchObject({ pluginToggleChanges: { first: false } });
    expect(firstPatch).not.toHaveProperty("pluginToggles");
    expect(secondPatch).toMatchObject({ pluginToggleChanges: { second: false } });

    const firstCommit = gate.enqueue(async () => { committed = applySettingsPatch(committed, firstPatch); });
    const secondCommit = gate.enqueue(async () => { committed = applySettingsPatch(committed, secondPatch); });
    await Promise.all([firstCommit, secondCommit]);

    expect(committed.pluginToggles).toEqual({ first: false, second: false });
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings";

describe("computer settings", () => {
  it("preserves desktop access and keeps the optional shortcut hidden by default", () => {
    for (const settings of [DEFAULT_SETTINGS, mergeSettings({}), mergeSettings({ profiles: [] })]) {
      expect(settings).toMatchObject({ computerEnabled: true, showComputerButton: false });
    }
  });

  it("round-trips the independent choices and normalizes malformed values", () => {
    for (const computerEnabled of [true, false]) for (const showComputerButton of [true, false]) {
      const saved = mergeSettings({ ...DEFAULT_SETTINGS, computerEnabled, showComputerButton });
      expect(mergeSettings(JSON.parse(JSON.stringify(saved)))).toMatchObject({ computerEnabled, showComputerButton });
    }
    expect(mergeSettings({ profiles: [], computerEnabled: "false", showComputerButton: "true" }))
      .toMatchObject({ computerEnabled: true, showComputerButton: false });
  });
});

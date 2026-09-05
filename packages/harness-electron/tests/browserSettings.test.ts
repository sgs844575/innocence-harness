import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings";

describe("browser settings persistence", () => {
  it("preserves existing browser access and validates certificates by default", () => {
    for (const settings of [DEFAULT_SETTINGS, mergeSettings({}), mergeSettings({ profiles: [] })]) {
      expect(settings.browserEnabled).toBe(true);
      expect(settings.browserIgnoreCertificateErrors).toBe(false);
    }
  });

  it("round-trips explicit choices and rejects malformed booleans", () => {
    const saved = mergeSettings({ ...DEFAULT_SETTINGS, browserEnabled: false, browserIgnoreCertificateErrors: true });
    expect(mergeSettings(JSON.parse(JSON.stringify(saved)))).toMatchObject({
      browserEnabled: false, browserIgnoreCertificateErrors: true,
    });
    expect(mergeSettings({ profiles: [], browserEnabled: "false", browserIgnoreCertificateErrors: "true" })).toMatchObject({
      browserEnabled: true, browserIgnoreCertificateErrors: false,
    });
  });
});

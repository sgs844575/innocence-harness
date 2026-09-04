import { describe, expect, it } from "vitest";
import {
  DARK_CODE_THEMES,
  DEFAULT_CODE_THEME_DARK,
  DEFAULT_CODE_THEME_LIGHT,
  LIGHT_CODE_THEMES,
  normalizeCodeThemeId,
} from "./codeThemes";

describe("code theme presets", () => {
  it("uses the current default variants in both preset lists", () => {
    expect(LIGHT_CODE_THEMES[0]).toBe(DEFAULT_CODE_THEME_LIGHT);
    expect(DARK_CODE_THEMES[0]).toBe(DEFAULT_CODE_THEME_DARK);
    expect(LIGHT_CODE_THEMES).not.toContain("github-light" as never);
    expect(DARK_CODE_THEMES).not.toContain("github-dark" as never);
  });

  it("migrates legacy aliases without changing other bundled theme ids", () => {
    expect(normalizeCodeThemeId("github-light", DEFAULT_CODE_THEME_LIGHT)).toBe(DEFAULT_CODE_THEME_LIGHT);
    expect(normalizeCodeThemeId("github-dark", DEFAULT_CODE_THEME_DARK)).toBe(DEFAULT_CODE_THEME_DARK);
    expect(normalizeCodeThemeId(" dracula ", DEFAULT_CODE_THEME_DARK)).toBe("dracula");
    expect(normalizeCodeThemeId("", DEFAULT_CODE_THEME_LIGHT)).toBe(DEFAULT_CODE_THEME_LIGHT);
  });
});

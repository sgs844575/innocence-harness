export const DEFAULT_CODE_THEME_LIGHT = "github-light-default";
export const DEFAULT_CODE_THEME_DARK = "github-dark-default";

export const LIGHT_CODE_THEMES = [
  DEFAULT_CODE_THEME_LIGHT,
  "one-light",
  "min-light",
  "solarized-light",
] as const;

export const DARK_CODE_THEMES = [
  DEFAULT_CODE_THEME_DARK,
  "one-dark-pro",
  "dracula",
  "nord",
  "tokyo-night",
  "min-dark",
] as const;

const LEGACY_CODE_THEME_ALIASES: Readonly<Record<string, string>> = {
  "github-light": DEFAULT_CODE_THEME_LIGHT,
  "github-dark": DEFAULT_CODE_THEME_DARK,
};

export function normalizeCodeThemeId(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const themeId = raw.trim();
  return LEGACY_CODE_THEME_ALIASES[themeId] ?? themeId;
}

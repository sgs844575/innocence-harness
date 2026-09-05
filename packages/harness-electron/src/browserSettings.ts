export interface BrowserSettings {
  /** Enables the embedded browser surface. Missing values preserve existing access. */
  browserEnabled?: boolean;
  /** Browser-only certificate bypass; applied at host startup. */
  browserIgnoreCertificateErrors?: boolean;
}

export const BROWSER_SETTINGS_DEFAULTS = {
  browserEnabled: true,
  browserIgnoreCertificateErrors: false,
} as const;

export function normalizeBrowserSettings(raw: BrowserSettings): Required<BrowserSettings> {
  return {
    browserEnabled: typeof raw.browserEnabled === "boolean" ? raw.browserEnabled : true,
    browserIgnoreCertificateErrors: raw.browserIgnoreCertificateErrors === true,
  };
}

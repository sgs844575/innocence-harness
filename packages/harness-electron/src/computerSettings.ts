export interface ComputerSettings {
  /** Master switch for desktop tools, related servers and the bundled skill. */
  computerEnabled?: boolean;
  /** Controls only the shortcut in the composer. */
  showComputerButton?: boolean;
}

export const COMPUTER_SETTINGS_DEFAULTS = {
  computerEnabled: true,
  showComputerButton: false,
} as const;

export function normalizeComputerSettings(raw: ComputerSettings): Required<ComputerSettings> {
  return {
    computerEnabled: typeof raw.computerEnabled === "boolean" ? raw.computerEnabled : true,
    showComputerButton: raw.showComputerButton === true,
  };
}

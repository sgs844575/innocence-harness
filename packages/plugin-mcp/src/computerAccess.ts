/** A server can declare desktop access even when its name is unrelated. */
export interface ComputerCapability {
  capability?: "computer";
}

export function isComputerCapability(name: string, options: ComputerCapability = {}): boolean {
  return options.capability === "computer" || /^(computer|desktop)(?:[-_].*)?$/i.test(name);
}

export const COMPUTER_DISABLED = "Computer control is disabled in Settings.";

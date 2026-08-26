import type { HarnessSettings } from "../../../shared/ipc";
import type { HarnessSettingsPatch } from "../../../shared/settingsPatch";

export interface SettingsCommitterDeps {
  save(patch: HarnessSettingsPatch): Promise<HarnessSettings>;
  apply(settings: HarnessSettings): void;
  refresh(): void;
  onError(error: unknown): void;
}

/** Commits renderer settings only after the host reports durable persistence. */
export function createSettingsCommitter({ save, apply, refresh, onError }: SettingsCommitterDeps) {
  return async (patch: HarnessSettingsPatch): Promise<HarnessSettings> => {
    try {
      const committed = await save(patch);
      apply(committed);
      refresh();
      return committed;
    } catch (error) {
      onError(error);
      throw error;
    }
  };
}

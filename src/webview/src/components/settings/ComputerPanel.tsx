import { useRef, useState } from "react";
import type { HarnessSettings } from "../../../../shared/ipc";
import type { HarnessSettingsPatch } from "../../../../shared/settingsPatch";
import { Switch } from "../ui/Switch";
import { SettingsRow } from "./rows";

interface Props {
  t: (key: string) => string;
  settings: HarnessSettings | null;
  onPatchSettings: (patch: HarnessSettingsPatch) => void | Promise<void>;
}

export function ComputerPanel({ t, settings, onPatchSettings }: Props): React.JSX.Element {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: HarnessSettingsPatch): Promise<void> => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await onPatchSettings(patch);
    } catch (cause) {
      setError(`${t("settings.computer.failed")} ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto w-full max-w-[832px]" data-testid="computer-settings">
      <h1 className="mb-7 text-[28px] font-bold text-(--color-foreground-strong)">{t("settings.section.computer")}</h1>
      <div className="divide-y divide-(--color-border) overflow-hidden rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised)">
        <SettingsRow title={t("settings.computer.enabled")} desc={t("settings.computer.enabled.desc")}>
          <Switch tone="neutral" checked={settings?.computerEnabled !== false} disabled={!settings || busy}
            label={t("settings.computer.enabled")} onChange={(next) => void save({ computerEnabled: next })} />
        </SettingsRow>
        <SettingsRow title={t("settings.computer.showButton")} desc={t("settings.computer.showButton.desc")}>
          <Switch tone="neutral" checked={settings?.showComputerButton === true} disabled={!settings || busy}
            label={t("settings.computer.showButton")} onChange={(next) => void save({ showComputerButton: next })} />
        </SettingsRow>
      </div>
      {error && <p role="alert" className="mt-4 break-words text-(--color-tool-err)">{error}</p>}
    </div>
  );
}

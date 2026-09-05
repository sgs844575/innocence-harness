import { Monitor } from "lucide-react";
import type { HarnessSettings } from "../../../../shared/ipc";

export function ComputerButton({ t, settings, onSelect }: {
  t: (key: string) => string;
  settings: HarnessSettings | null;
  onSelect: () => void;
}): React.JSX.Element | null {
  if (!settings || settings.computerEnabled === false || !settings.showComputerButton || settings.pluginToggles?.computer === false) return null;
  return (
    <button type="button" aria-label={t("composer.computer")} title={t("composer.computer")}
      onClick={onSelect}
      className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)">
      <Monitor size={17} strokeWidth={1.4} />
    </button>
  );
}

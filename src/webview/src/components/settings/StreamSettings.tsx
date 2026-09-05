import type { HarnessSettings } from "../../../../shared/ipc";
import type { HarnessSettingsPatch } from "../../../../shared/settingsPatch";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { SettingsRow } from "./rows";

export function StreamSettings({ t, settings, onPatchSettings }: {
  t: (key: string) => string;
  settings: HarnessSettings;
  onPatchSettings: (patch: HarnessSettingsPatch) => void;
}): React.JSX.Element {
  return (      <div className="divide-y divide-(--color-hairline) rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised)">
        <SettingsRow title={t("settings.general.interactionMode")} desc={t("settings.general.interactionMode.desc")}>
          <Select
            value={settings.interactionMode ?? "queue"}
            onChange={(value) => onPatchSettings({ interactionMode: value as HarnessSettings["interactionMode"] })}
            ariaLabel={t("settings.general.interactionMode")}
            options={(["queue", "steer"] as const).map((mode) => ({
              value: mode,
              label: t(`settings.general.interactionMode.${mode}`),
            }))}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.questionAutoContinue")} desc={t("settings.general.questionAutoContinue.desc")}>
          <Switch
            checked={settings.questionAutoContinue === true}
            onChange={(next) => onPatchSettings({ questionAutoContinue: next })}
            label={t("settings.general.questionAutoContinue")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.showThinking")} desc={t("settings.general.showThinking.desc")}>
          <Switch
            checked={settings.showThinking !== false}
            onChange={(next) => onPatchSettings({ showThinking: next })}
            label={t("settings.general.showThinking")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.showTodos")} desc={t("settings.general.showTodos.desc")}>
          <Switch
            checked={settings.showTodos !== false}
            onChange={(next) => onPatchSettings({ showTodos: next })}
            label={t("settings.general.showTodos")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.groupExplore")} desc={t("settings.general.groupExplore.desc")}>
          <Switch
            checked={settings.groupExploreTools !== false}
            onChange={(next) => onPatchSettings({ groupExploreTools: next })}
            label={t("settings.general.groupExplore")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.groupTerminal")} desc={t("settings.general.groupTerminal.desc")}>
          <Switch
            checked={settings.groupTerminalCommands !== false}
            onChange={(next) => onPatchSettings({ groupTerminalCommands: next })}
            label={t("settings.general.groupTerminal")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.aggregateResponse")} desc={t("settings.general.aggregateResponse.desc")}>
          <Switch
            checked={settings.aggregateResponse === true}
            onChange={(next) => onPatchSettings({ aggregateResponse: next })}
            label={t("settings.general.aggregateResponse")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.groupChanges")} desc={t("settings.general.groupChanges.desc")}>
          <Switch
            checked={settings.groupFileChanges === true}
            onChange={(next) => onPatchSettings({ groupFileChanges: next })}
            label={t("settings.general.groupChanges")}
          />
        </SettingsRow>
      </div>);
}

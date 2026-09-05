// 常规设置面板：界面语言/默认权限/终端、网络代理、应用行为、Agent 消息流、
// 任务归档、数据存储路径、引导与体验优化。行原语在 ./rows（外观/关于页复用）；
// 面板只发 onPatchSettings 与回调，宿主（App）负责 IPC 与目录选择。
import type { AppInfo, HarnessSettings, PermissionMode } from "../../../../shared/ipc";
import type { HarnessSettingsPatch } from "../../../../shared/settingsPatch";
import { StreamSettings } from "./StreamSettings";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { SettingsRow, TextSaveRow } from "./rows";

/** 卡片容器：行间发丝分隔（与外观页同款）。 */
const card = "divide-y divide-(--color-hairline) rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised)";
/** 分区大标题（与各设置页一致）。 */
const pageTitle = "mb-5 text-[22px] font-bold text-(--color-foreground-strong)";
/** 次级小按钮（沿用模型面板「拉取」钮样式）。 */
const actionButton =
  "flex h-8 shrink-0 items-center rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)";

const PERMISSION_MODES: PermissionMode[] = ["ask", "auto", "plan", "full"];
const LOCALES = [
  { id: "", label: "跟随系统" },
  { id: "zh-CN", label: "简体中文" },
  { id: "en-US", label: "English" },
] as const;
const TERMINAL_SHELLS = ["auto", "cmd", "powershell", "gitbash", "wsl"] as const;
const RETENTION_DAYS = [1, 3, 7, 14, 30] as const;

export function GeneralPanel({
  t,
  settings,
  appInfo,
  onPatchSettings,
  dataRoot,
  onChangeDataRoot,
  onOpenOnboarding,
}: {
  t: (key: string) => string;
  settings: HarnessSettings;
  appInfo: AppInfo | null;
  onPatchSettings: (patch: HarnessSettingsPatch) => void;
  /** 当前数据根目录；空值 = 隐藏数据存储卡片。 */
  dataRoot?: string | null;
  /** 「选择文件夹」回调（宿主负责目录选择与数据迁移）。 */
  onChangeDataRoot?: () => void;
  /** 「打开引导」回调；缺省 = 隐藏引导卡片。 */
  onOpenOnboarding?: () => void;
}): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <h1 className={pageTitle}>{t("settings.section.general")}</h1>

      {/* 界面与终端 */}
      <div className={card}>
        <SettingsRow title={t("settings.general.language")} desc={t("settings.general.language.desc")}>
          <Select
            value={settings.locale ?? ""}
            onChange={(value) => onPatchSettings({ locale: value as HarnessSettings["locale"] })}
            ariaLabel={t("settings.general.language")}
            options={LOCALES.map((locale) => ({ value: locale.id, label: locale.label }))}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.permission")} desc={t("settings.general.permission.desc")}>
          <Select
            value={settings.permissionMode}
            onChange={(value) => onPatchSettings({ permissionMode: value as PermissionMode })}
            ariaLabel={t("settings.general.permission")}
            options={PERMISSION_MODES.map((mode) => ({ value: mode, label: t(`permission.mode.${mode}`) }))}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.terminalInherit")} desc={t("settings.general.terminalInherit.desc")}>
          <Switch
            checked={settings.terminalInheritProfile !== false}
            onChange={(next) => onPatchSettings({ terminalInheritProfile: next })}
            label={t("settings.general.terminalInherit")}
          />
        </SettingsRow>
        <TextSaveRow
          title={t("settings.general.terminalFont")}
          desc={t("settings.general.terminalFont.desc")}
          value={settings.terminalFontFamily ?? ""}
          placeholder={t("settings.general.terminalFont.placeholder")}
          saveLabel={t("settings.general.save")}
          onCommit={(next) => onPatchSettings({ terminalFontFamily: next })}
        />
        <SettingsRow title={t("settings.general.terminalShell")} desc={t("settings.general.terminalShell.desc")}>
          <Select
            value={settings.terminalShell ?? "auto"}
            onChange={(value) => onPatchSettings({ terminalShell: value as HarnessSettings["terminalShell"] })}
            ariaLabel={t("settings.general.terminalShell")}
            options={TERMINAL_SHELLS.map((shell) => ({
              value: shell,
              label: shell === "auto" ? t("settings.general.terminalShell.auto") : shell,
            }))}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.enhancedFindGrep")} desc={t("settings.general.enhancedFindGrep.desc")}>
          <Switch
            checked={settings.enhancedFindGrep !== false}
            onChange={(next) => onPatchSettings({ enhancedFindGrep: next })}
            label={t("settings.general.enhancedFindGrep")}
          />
        </SettingsRow>
      </div>

      {/* 网络（代理/证书，重启生效） */}
      <div className={card}>
        <TextSaveRow
          title={t("settings.general.httpProxy")}
          desc={t("settings.general.httpProxy.desc")}
          value={settings.httpProxy ?? ""}
          placeholder={t("settings.general.httpProxy.placeholder")}
          saveLabel={t("settings.general.save")}
          onCommit={(next) => onPatchSettings({ httpProxy: next })}
        />
        <TextSaveRow
          title={t("settings.general.proxyBypass")}
          desc={t("settings.general.proxyBypass.desc")}
          value={settings.proxyBypass ?? ""}
          placeholder={t("settings.general.proxyBypass.placeholder")}
          saveLabel={t("settings.general.save")}
          onCommit={(next) => onPatchSettings({ proxyBypass: next })}
        />
        <TextSaveRow
          title={t("settings.general.customCaCert")}
          desc={t("settings.general.customCaCert.desc")}
          value={settings.customCaCert ?? ""}
          placeholder={t("settings.general.customCaCert.placeholder")}
          saveLabel={t("settings.general.save")}
          onCommit={(next) => onPatchSettings({ customCaCert: next })}
        />
      </div>

      {/* 应用行为（托盘项仅 Windows 可用） */}
      <div className={card}>
        <SettingsRow title={t("settings.general.hardwareAccel")} desc={t("settings.general.hardwareAccel.desc")}>
          <Switch
            checked={settings.hardwareAcceleration !== false}
            onChange={(next) => onPatchSettings({ hardwareAcceleration: next })}
            label={t("settings.general.hardwareAccel")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.previewUpdates")} desc={t("settings.general.previewUpdates.desc")}>
          <Switch
            checked={settings.previewUpdates === true}
            onChange={(next) => onPatchSettings({ previewUpdates: next })}
            label={t("settings.general.previewUpdates")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.autoUpdates")} desc={t("settings.general.autoUpdates.desc")}>
          <Switch
            checked={settings.autoDownloadUpdates !== false}
            onChange={(next) => onPatchSettings({ autoDownloadUpdates: next })}
            label={t("settings.general.autoUpdates")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.taskNotifications")} desc={t("settings.general.taskNotifications.desc")}>
          <Switch
            checked={settings.taskNotifications !== false}
            onChange={(next) => onPatchSettings({ taskNotifications: next })}
            label={t("settings.general.taskNotifications")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.notificationSound")} desc={t("settings.general.notificationSound.desc")}>
          <Switch
            checked={settings.notificationSound !== false}
            onChange={(next) => onPatchSettings({ notificationSound: next })}
            label={t("settings.general.notificationSound")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.closeToTray")} desc={t("settings.general.closeToTray.desc")}>
          <Switch
            checked={settings.closeToTray === true}
            onChange={(next) => onPatchSettings({ closeToTray: next })}
            label={t("settings.general.closeToTray")}
            disabled={appInfo?.platform !== "win32"}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.keepAwake")} desc={t("settings.general.keepAwake.desc")}>
          <Switch
            checked={settings.keepAwake === true}
            onChange={(next) => onPatchSettings({ keepAwake: next })}
            label={t("settings.general.keepAwake")}
          />
        </SettingsRow>
      </div>

      <StreamSettings t={t} settings={settings} onPatchSettings={onPatchSettings} />

      {/* 任务归档 */}
      <div className={card}>
        <SettingsRow title={t("settings.general.autoArchive")} desc={t("settings.general.autoArchive.desc")}>
          <Switch
            checked={settings.autoArchiveTasks === true}
            onChange={(next) => onPatchSettings({ autoArchiveTasks: next })}
            label={t("settings.general.autoArchive")}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.general.archiveRetention")} desc={t("settings.general.archiveRetention.desc")}>
          <Select
            value={String(settings.archiveRetentionDays ?? 7)}
            onChange={(value) => onPatchSettings({ archiveRetentionDays: Number(value) })}
            ariaLabel={t("settings.general.archiveRetention")}
            options={RETENTION_DAYS.map((days) => ({
              value: String(days),
              label: t(`settings.general.archiveRetention.d${days}`),
            }))}
          />
        </SettingsRow>
      </div>

      {/* 数据存储路径（宿主提供当前根目录时才渲染） */}
      {dataRoot ? (
        <div className={card}>
          <SettingsRow title={t("settings.general.dataRoot")} desc={t("settings.general.dataRoot.desc")}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="max-w-56 truncate font-mono text-[13px] text-(--color-muted)" title={dataRoot}>
                {dataRoot}
              </span>
              <button type="button" onClick={() => onChangeDataRoot?.()} className={actionButton}>
                {t("settings.general.dataRoot.pick")}
              </button>
            </span>
          </SettingsRow>
        </div>
      ) : null}

      {/* 引导（宿主提供入口时才渲染） */}
      {onOpenOnboarding ? (
        <div className={card}>
          <SettingsRow title={t("settings.general.onboarding")} desc={t("settings.general.onboarding.desc")}>
            <button type="button" onClick={onOpenOnboarding} className={actionButton}>
              {t("settings.general.onboarding.open")}
            </button>
          </SettingsRow>
        </div>
      ) : null}

      {/* 体验优化 */}
      <div className={card}>
        <SettingsRow title={t("settings.general.telemetry")} desc={t("settings.general.telemetry.desc")}>
          <Switch
            checked={settings.telemetryOptIn === true}
            onChange={(next) => onPatchSettings({ telemetryOptIn: next })}
            label={t("settings.general.telemetry")}
          />
        </SettingsRow>
      </div>
    </div>
  );
}

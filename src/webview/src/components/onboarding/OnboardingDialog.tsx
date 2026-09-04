// 首次启动引导弹窗：界面语言/界面主题/默认权限三个快速选项（选项口径与
// 常规/外观设置页一致）。Esc/遮罩 = 跳过；完成/跳过均回调宿主（App 落
// onboarded 标记）。本地草稿初值取当前设置，弹窗挂载即最新。
import { useEffect, useState } from "react";
import type { HarnessSettings, PermissionMode, ThemeMode } from "../../../../shared/ipc";
import logoUrl from "../../../../../logo.svg";
import { Select } from "../ui/Select";

export interface OnboardingChoice {
  locale: "zh-CN" | "en-US" | "";
  themeMode: ThemeMode;
  permissionMode: PermissionMode;
}

interface Props {
  t: (key: string) => string;
  /** 当前设置（草稿初值来源）。 */
  settings: HarnessSettings | null;
  onFinish: (choice: OnboardingChoice) => void;
  onSkip: () => void;
}

// 与常规设置面板（GeneralPanel）同一份语言选项。
const LOCALES = [
  { id: "", label: "跟随系统" },
  { id: "zh-CN", label: "简体中文" },
  { id: "en-US", label: "English" },
] as const;
// 与外观设置页（SettingsView THEME_MODES）同一份主题选项。
const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "dark", label: "深色" },
  { id: "light", label: "浅色" },
];
// 与常规设置面板同一份权限模式顺序。
const PERMISSION_MODES: PermissionMode[] = ["ask", "auto", "plan", "full"];

export function OnboardingDialog({ t, settings, onFinish, onSkip }: Props): React.JSX.Element {
  const [locale, setLocale] = useState<OnboardingChoice["locale"]>(settings?.locale ?? "");
  const [themeMode, setThemeMode] = useState<ThemeMode>(settings?.themeMode ?? "system");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(settings?.permissionMode ?? "ask");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSkip]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" role="dialog" aria-label={t("onboarding.title")}>
      <button type="button" aria-label={t("onboarding.skip")} onClick={onSkip} className="absolute inset-0 cursor-default bg-black/25" />
      <div data-state="open" className="modal-in relative w-[420px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)">
        <div className="mb-5 flex flex-col items-center text-center">
          <img src={logoUrl} alt="" className="mb-3 size-12 rounded-xl" />
          <span className="text-[15px] font-bold text-(--color-foreground-strong)">{t("onboarding.title")}</span>
          <span className="mt-1 text-(--color-muted)">{t("onboarding.subtitle")}</span>
        </div>

        <div className="mb-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-(--color-foreground)">{t("settings.general.language")}</span>
            <Select
              value={locale}
              onChange={(value) => setLocale(value as OnboardingChoice["locale"])}
              ariaLabel={t("settings.general.language")}
              options={LOCALES.map((item) => ({ value: item.id, label: item.label }))}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-(--color-foreground)">{t("settings.appearance.theme")}</span>
            <Select
              value={themeMode}
              onChange={(value) => setThemeMode(value as ThemeMode)}
              ariaLabel={t("settings.appearance.theme")}
              options={THEME_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-(--color-foreground)">{t("settings.general.permission")}</span>
            <Select
              value={permissionMode}
              onChange={(value) => setPermissionMode(value as PermissionMode)}
              ariaLabel={t("settings.general.permission")}
              options={PERMISSION_MODES.map((mode) => ({ value: mode, label: t(`permission.mode.${mode}`) }))}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="h-8 rounded-md border border-(--color-border) px-3 text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            {t("onboarding.skip")}
          </button>
          <button
            type="button"
            onClick={() => onFinish({ locale, themeMode, permissionMode })}
            className="h-8 rounded-md bg-(--color-brand) px-3 text-(--color-inverse) transition-opacity hover:opacity-80"
          >
            {t("onboarding.finish")}
          </button>
        </div>
      </div>
    </div>
  );
}

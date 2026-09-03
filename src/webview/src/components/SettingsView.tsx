// 设置页内容区（导航在左侧设置侧栏 SettingsSidebar）：卡片行样式（标题 +
// 描述 + 右侧控件）。常规（界面语言/默认权限）、外观（界面主题）、
// 模型服务（ModelsPanel 供应商管理）、关于（版本/平台）。主体宽度随窗口变化。
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { AppInfo, HarnessSettings, ModelInfo, PermissionMode, ProviderProfile, ThemeMode } from "../../../shared/ipc";
import logoUrl from "../../../../logo.svg";
import { ModelsPanel } from "./settings/ModelsPanel";
import { Select } from "./ui/Select";
import { Switch } from "./ui/Switch";
import { MarkdownView } from "./chat/MarkdownView";
import type { HarnessSettingsPatch } from "../../../shared/settingsPatch";

export type SettingsSection = "general" | "appearance" | "models" | "about";

const PERMISSION_MODES: PermissionMode[] = ["ask", "auto", "plan", "full"];
const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "dark", label: "深色" },
  { id: "light", label: "浅色" },
];
const LOCALES = [
  { id: "", label: "跟随系统" },
  { id: "zh-CN", label: "简体中文" },
  { id: "en-US", label: "English" },
] as const;

/** 代码高亮主题候选（shiki bundled 名直接作标签）。 */
const LIGHT_CODE_THEMES = ["github-light", "one-light", "min-light", "solarized-light"] as const;
const DARK_CODE_THEMES = ["github-dark", "one-dark-pro", "dracula", "nord", "tokyo-night", "min-dark"] as const;

/** 分区大标题（参考：设置名在主体区放大）。 */
const pageTitle = "mb-5 text-[22px] font-bold text-(--color-foreground-strong)";
/** 分组标题/描述。 */
const groupTitle = "text-[15px] font-semibold text-(--color-foreground-strong)";
const groupDesc = "mt-0.5 mb-2.5 text-(--color-muted)";

interface Props {
  t: (key: string) => string;
  settings: HarnessSettings | null;
  appInfo: AppInfo | null;
  /** 当前分区（由设置侧栏驱动）。 */
  section: SettingsSection;
  onPatchSettings: (patch: HarnessSettingsPatch) => void;
  onSetTheme: (mode: ThemeMode) => void;
  /** API 密钥写入宿主安全存储；缺省 = 面板隐藏密钥保存。 */
  onSetApiKey?: (profileId: string, apiKey: string) => void;
  /** 从供应商拉取模型清单；缺省 = 隐藏拉取钮。 */
  onFetchModels?: (profile: ProviderProfile) => Promise<ModelInfo[]>;
  /** 关于页「反馈问题」入口（缺省隐藏该行）。 */
  onFeedback?: () => void;
  /** 当前生效的界面主题（代码预览「当前生效」徽章用）。 */
  resolvedTheme?: "dark" | "light";
}

/** 卡片行：标题 + 描述（左）与控件（右），行间发丝分隔。 */
function SettingsRow({ title, desc, children }: { title: string; desc?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-(--color-foreground-strong)">{title}</div>
        {desc && <div className="mt-0.5 text-(--color-muted)">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** 字号步进框（12..18 px，失焦/回车提交并收窄）。 */
function FontSizeInput({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (next: number) => void;
  label: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (): void => {
    const n = Number(draft);
    if (Number.isFinite(n) && draft.trim() !== "") onCommit(Math.min(18, Math.max(12, Math.round(n))));
    else setDraft(String(value));
  };
  return (
    <span className="flex h-8 items-center gap-1 rounded-md border border-(--color-border) bg-(--color-surface) px-2.5">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        inputMode="numeric"
        aria-label={label}
        className="w-8 bg-transparent text-right outline-none text-(--color-foreground)"
      />
      <span className="text-(--color-faint)">px</span>
    </span>
  );
}

/** 代码预览卡：真实 shiki 高亮（浅色/深色各锁定单主题槽，界面主题如何都正确）；
 *  浅色卡在暗色界面里套 .light-scope 重取浅色 token。 */
function CodePreviewCard({
  t,
  title,
  themeId,
  active,
  dark,
  lineNumbers,
}: {
  t: (key: string) => string;
  title: string;
  themeId: string;
  active: boolean;
  dark: boolean;
  lineNumbers: boolean;
}): React.JSX.Element {
  const sample = "```ts\nconst themePreview: ThemeConfig = {\n  surface: \"sidebar\",\n  accent: \"#339CFF\",\n};\n```";
  return (
    <div
      className={`overflow-hidden rounded-(--radius-pop) border bg-(--color-raised) ${
        active ? "border-(--color-accent)" : "border-(--color-border)"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-(--color-foreground-strong)">{title}</span>
        {active && (
          <span className="ml-auto rounded bg-(--color-selected) px-1.5 py-0.5 leading-none text-(--color-muted)">
            {t("settings.appearance.preview.current")}
          </span>
        )}
      </div>
      <div className={dark ? "dark" : "light-scope"}>
        <div className="mx-3 mb-3 [&_.msg-body_pre]:text-[12px] [&_code]:leading-relaxed">
          <MarkdownView source={sample} code={{ light: themeId, dark: themeId, lineNumbers }} />
        </div>
      </div>
      <div className="px-3 pb-2 font-mono text-(--color-faint)">{themeId}</div>
    </div>
  );
}

export function SettingsView({ t, settings, appInfo, section, onPatchSettings, onSetTheme, onSetApiKey, onFetchModels, onFeedback, resolvedTheme }: Props): React.JSX.Element {
  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-6">
      {section === "general" && settings && (
        <div className="mx-auto w-full max-w-[720px] space-y-6">
          <h1 className={pageTitle}>{t("settings.section.general")}</h1>
          <div className="divide-y divide-(--color-hairline) rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised)">
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
          </div>
        </div>
      )}
      {section === "appearance" && settings && (
        <div className="mx-auto w-full max-w-[720px] space-y-7">
          <h1 className={pageTitle}>{t("settings.section.appearance")}</h1>

          {/* 界面设置 */}
          <section>
            <h2 className={groupTitle}>{t("settings.appearance.uiGroup")}</h2>
            <p className={groupDesc}>{t("settings.appearance.uiGroup.desc")}</p>
            <div className="divide-y divide-(--color-hairline) rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised)">
              <SettingsRow title={t("settings.appearance.theme")} desc={t("settings.appearance.theme.desc")}>
                <Select
                  value={settings.themeMode ?? "system"}
                  onChange={(value) => onSetTheme(value as ThemeMode)}
                  ariaLabel={t("settings.appearance.theme")}
                  options={THEME_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
                />
              </SettingsRow>
              <SettingsRow title={t("settings.appearance.fontSize")} desc={t("settings.appearance.fontSize.desc")}>
                <FontSizeInput
                  value={settings.uiFontSize ?? 14}
                  onCommit={(next) => onPatchSettings({ uiFontSize: next })}
                  label={t("settings.appearance.fontSize")}
                />
              </SettingsRow>
            </div>
          </section>

          {/* 代码设置 */}
          <section>
            <h2 className={groupTitle}>{t("settings.appearance.codeGroup")}</h2>
            <p className={groupDesc}>{t("settings.appearance.codeGroup.desc")}</p>
            <div className="divide-y divide-(--color-hairline) rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised)">
              <SettingsRow title={t("settings.appearance.codeThemeLight")} desc={t("settings.appearance.codeThemeLight.desc")}>
                <Select
                  value={settings.codeThemeLight ?? "github-light"}
                  onChange={(value) => onPatchSettings({ codeThemeLight: value })}
                  ariaLabel={t("settings.appearance.codeThemeLight")}
                  options={LIGHT_CODE_THEMES.map((id) => ({ value: id, label: id }))}
                />
              </SettingsRow>
              <SettingsRow title={t("settings.appearance.codeThemeDark")} desc={t("settings.appearance.codeThemeDark.desc")}>
                <Select
                  value={settings.codeThemeDark ?? "github-dark"}
                  onChange={(value) => onPatchSettings({ codeThemeDark: value })}
                  ariaLabel={t("settings.appearance.codeThemeDark")}
                  options={DARK_CODE_THEMES.map((id) => ({ value: id, label: id }))}
                />
              </SettingsRow>
              <SettingsRow title={t("settings.appearance.lineNumbers")} desc={t("settings.appearance.lineNumbers.desc")}>
                <Switch
                  checked={settings.codeLineNumbers !== false}
                  onChange={(next) => onPatchSettings({ codeLineNumbers: next })}
                  label={t("settings.appearance.lineNumbers")}
                />
              </SettingsRow>
              <SettingsRow title={t("settings.appearance.wordWrap")} desc={t("settings.appearance.wordWrap.desc")}>
                <Switch
                  checked={settings.codeWordWrap === true}
                  onChange={(next) => onPatchSettings({ codeWordWrap: next })}
                  label={t("settings.appearance.wordWrap")}
                />
              </SettingsRow>
              <SettingsRow title={t("settings.appearance.codeFontSize")} desc={t("settings.appearance.codeFontSize.desc")}>
                <FontSizeInput
                  value={settings.codeFontSize ?? 14}
                  onCommit={(next) => onPatchSettings({ codeFontSize: next })}
                  label={t("settings.appearance.codeFontSize")}
                />
              </SettingsRow>
            </div>
          </section>

          {/* 代码预览（双主题作用域并排，当前界面主题打徽章） */}
          <section>
            <h2 className={groupTitle}>{t("settings.appearance.preview")}</h2>
            <p className={groupDesc}>{t("settings.appearance.preview.desc")}</p>
            <div className="grid grid-cols-2 gap-3">
              <CodePreviewCard
                t={t}
                title={t("settings.appearance.preview.light")}
                themeId={settings.codeThemeLight ?? "github-light"}
                active={resolvedTheme === "light"}
                dark={false}
                lineNumbers={settings.codeLineNumbers !== false}
              />
              <CodePreviewCard
                t={t}
                title={t("settings.appearance.preview.dark")}
                themeId={settings.codeThemeDark ?? "github-dark"}
                active={resolvedTheme !== "light"}
                dark
                lineNumbers={settings.codeLineNumbers !== false}
              />
            </div>
          </section>
        </div>
      )}
      {section === "models" && (
        <div className="mx-auto w-full max-w-[1000px]">
          <h1 className={pageTitle}>{t("settings.section.models")}</h1>
          {!settings ? (
            <p className="text-(--color-muted)">{t("settings.models.empty")}</p>
          ) : (
            <ModelsPanel
              t={t}
              settings={settings}
              onPatchSettings={onPatchSettings}
              onSetApiKey={onSetApiKey}
              onFetchModels={onFetchModels}
            />
          )}
        </div>
      )}
      {section === "about" && (
        <div className="mx-auto flex w-full max-w-[720px] flex-col items-center pt-14">
          <img src={logoUrl} alt={t("app.name")} className="size-16 rounded-2xl shadow-(--shadow-card)" />
          <h1 className="mt-4 text-[18px] font-bold text-(--color-foreground-strong)">{t("app.name")}</h1>
          <span className="mt-2 rounded-full bg-(--color-selected) px-2 py-0.5 font-mono leading-relaxed text-(--color-muted)">
            v{appInfo?.version ?? "—"}
          </span>
          <p className="mt-3 text-(--color-muted)">{t("settings.about.desc")}</p>
          <div className="mt-8 w-full max-w-[420px] divide-y divide-(--color-hairline) rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised)">
            <SettingsRow title={t("settings.about.version")}>
              <span className="font-mono text-(--color-muted)">{appInfo?.version ?? "—"}</span>
            </SettingsRow>
            <SettingsRow title={t("settings.about.platform")}>
              <span className="font-mono text-(--color-muted)">{appInfo?.platform ?? "—"}</span>
            </SettingsRow>
            {onFeedback && (
              <button
                type="button"
                onClick={onFeedback}
                className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-(--color-hover)"
              >
                <span className="min-w-0 flex-1 text-(--color-foreground-strong)">{t("titlebar.menu.feedback")}</span>
                <ExternalLink size={13} className="shrink-0 text-(--color-faint)" aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

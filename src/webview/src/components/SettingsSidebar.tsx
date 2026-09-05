// 设置态侧栏（替换会话侧栏，同一灰色列）：返回工作区 + 分区导航
// 基础设置与帮助分组 + 底部用户行（与主侧栏同式）。
import { ArrowLeft, Box, Globe, Info, Monitor, Palette, SlidersHorizontal } from "lucide-react";
import logoUrl from "../../../../logo.svg";
import type { SettingsSection } from "./SettingsView";

interface Props {
  t: (key: string) => string;
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  onBack: () => void;
}

const BASIC_SECTIONS: readonly { id: SettingsSection; key: string; icon: typeof SlidersHorizontal }[] = [
  { id: "general", key: "settings.section.general", icon: SlidersHorizontal },
  { id: "appearance", key: "settings.section.appearance", icon: Palette },
  { id: "models", key: "settings.section.models", icon: Box },
  { id: "browser", key: "settings.section.browser", icon: Globe },
  { id: "computer", key: "settings.section.computer", icon: Monitor },
];

const GROUPS = [
  { key: "settings.group.basic", sections: BASIC_SECTIONS },
  { key: "settings.group.help", sections: [{ id: "about" as const, key: "settings.section.about", icon: Info }] },
];

export function SettingsSidebar({ t, section, onSelect, onBack }: Props): React.JSX.Element {
  return (
    <aside data-testid="settings-sidebar" className="flex h-full w-full flex-col overflow-hidden">
      <nav className="scrollbar-thin flex min-h-0 flex-col gap-px overflow-y-auto px-2 pt-3.5">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
        >
          <ArrowLeft size={16} />
          {t("settings.back")}
        </button>
        {GROUPS.map((group) => (
          <section key={group.key} aria-label={t(group.key)} className="mb-5 flex flex-col gap-1">
            <h2 className="mb-1 px-2.5 text-[12px] text-(--color-faint)">{t(group.key)}</h2>
            {group.sections.map(({ id, key, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                aria-pressed={section === id}
                className={`flex h-8 items-center gap-2 rounded-(--radius-pop) px-2.5 text-left focus-visible:outline-2 focus-visible:outline-(--color-accent) ${
                  section === id
                    ? "bg-(--color-selected) font-medium text-(--color-foreground-strong)"
                    : "text-(--color-foreground) hover:bg-(--color-hover)"
                }`}
              >
                <Icon size={16} strokeWidth={1.4} className="text-(--color-muted)" aria-hidden />
                {t(key)}
              </button>
            ))}
          </section>
        ))}
      </nav>

      {/* 底部用户行：与主侧栏同式（头像 + 用户名 + 本地徽标 + 状态点）。 */}
      <footer className="mt-auto flex shrink-0 items-center gap-2.5 px-4 pb-4 pt-2">
        <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-(--color-background)">
          <img src={logoUrl} alt="" className="size-[15px] rounded-[3px]" />
        </div>
        <span className="min-w-0 truncate font-bold text-(--color-foreground-strong)">{t("user.you")}</span>
        <span className="shrink-0 rounded-full bg-(--color-background) px-1.5 py-0.5 leading-none text-(--color-muted)">
          {t("sidebar.localMode")}
        </span>
        <span
          aria-label={t("status.ok")}
          title={t("status.ok")}
          className="ml-auto grid size-7 place-items-center"
        >
          <span className="size-2 rounded-full bg-(--color-tool-ok)" />
        </span>
      </footer>
    </aside>
  );
}

import { useCallback } from "react";
import {
  MessageSquarePlus,
  PanelLeftOpen,
  Settings as SettingsIcon,
} from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { SettingsNav, SettingsRail } from "../components/SettingsNav";
import { NavRail } from "../components/NavRail";
import { SettingsView } from "../components/SettingsView";
import type { AppShellNav } from "../components/AppShell";
import type { AppInfo, HarnessSettings } from "../../../shared/ipc";
import type { SessionController } from "./useSessionController";

export function useAppNavigation({
  t,
  sessions,
  settings,
  appInfo,
  onSettingsChange,
  onPickWorkspace,
}: {
  t: (key: string) => string;
  sessions: SessionController;
  settings: HarnessSettings | null;
  appInfo: AppInfo | null;
  onSettingsChange: (settings: HarnessSettings) => void;
  onPickWorkspace: () => void;
}) {
  const sidebar = useCallback(
    (nav: AppShellNav) =>
      nav.view === "settings" ? (
        <SettingsNav t={t} section={nav.section} onSelect={nav.selectSection} onBack={nav.backToChat} />
      ) : (
        <Sidebar
          t={t}
          appName="InnocenceHarness"
          sessions={sessions.sessions}
          activeId={sessions.activeId}
          onSelect={(id) => { nav.closeDrawerOnNavigate(); sessions.selectSession(id); }}
          onNew={() => { nav.closeDrawerOnNavigate(); sessions.newSession(); }}
          onDelete={(id) => void sessions.deleteSession(id)}
          onOpenSettings={nav.openSettings}
        />
      ),
    [t, sessions],
  );
  const rail = useCallback(
    (nav: AppShellNav) =>
      nav.view === "settings" ? (
        <SettingsRail t={t} section={nav.section} onSelect={nav.selectSection} onBack={nav.backToChat} />
      ) : (
        <NavRail
          top={{ icon: MessageSquarePlus, label: t("sidebar.nav.newChat"), onClick: () => { nav.closeDrawerOnNavigate(); sessions.newSession(); } }}
          items={[{ icon: PanelLeftOpen, label: t("sidebar.open"), onClick: nav.expandNav }]}
          bottom={{ icon: SettingsIcon, label: t("sidebar.settings"), onClick: nav.openSettings }}
        />
      ),
    [t, sessions],
  );
  const settingsView = useCallback(
    (nav: AppShellNav) => settings ? (
      <SettingsView
        t={t}
        section={nav.section}
        settings={settings}
        appInfo={appInfo}
        onSettingsChange={onSettingsChange}
        onPickWorkspace={onPickWorkspace}
      />
    ) : null,
    [t, settings, appInfo, onSettingsChange, onPickWorkspace],
  );
  return { sidebar, rail, settingsView };
}

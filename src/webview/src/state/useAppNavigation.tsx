import { useCallback, useEffect, useState } from "react";
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
import { useSidebarState } from "./useSidebarState";
import { api } from "../lib/ipc";
import { reduceSidebarSessionStatuses, subscribeSidebarSessionStatus, type SidebarSessionStatus } from "./sidebarSessionStatus";
import logoUrl from "../../../../logo.svg";

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
  const sidebarState = useSidebarState(sessions.sessions);
  const [sessionStatuses, setSessionStatuses] = useState<Map<string, SidebarSessionStatus>>(() => new Map());

  useEffect(() => {
    const apply = (event: Parameters<typeof reduceSidebarSessionStatuses>[1]) => setSessionStatuses((previous) => reduceSidebarSessionStatuses(previous, event));
    const offLocal = subscribeSidebarSessionStatus(apply);
    const offDelta = api.onChatDelta((event) => apply({ type: "stream", sessionId: event.sessionId }));
    const offTool = api.onChatTool((event) => apply({ type: "stream", sessionId: event.sessionId }));
    const offThinking = api.onChatThinking((event) => apply({ type: "stream", sessionId: event.sessionId }));
    const offPermission = api.onChatPermission((event) => apply({ type: "permission", sessionId: event.sessionId }));
    const offDone = api.onChatDone((event) => apply({ type: "done", sessionId: event.sessionId }));
    const offError = api.onChatError((event) => apply({ type: "error", sessionId: event.sessionId }));
    return () => {
      offLocal();
      offDelta();
      offTool();
      offThinking();
      offPermission();
      offDone();
      offError();
    };
  }, []);

  useEffect(() => {
    const ids = new Set(sessions.sessions.map((session) => session.id));
    setSessionStatuses((previous) => new Map([...previous].filter(([id]) => ids.has(id))));
  }, [sessions.sessions]);

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
          sidebar={sidebarState}
          sessionStatuses={sessionStatuses}
          onSelect={(id) => { nav.closeDrawerOnNavigate(); sessions.selectSession(id); }}
          onNew={() => { nav.closeDrawerOnNavigate(); sessions.newSession(); }}
          onDelete={(id) => void sessions.deleteSession(id)}
          onArchive={(id) => void sidebarState.archiveSession(id, !sidebarState.state.archived[id])}
          onOpenSettings={nav.openSettings}
          onAutomation={nav.openAutomation}
          onPlugins={() => { nav.openSettings(); nav.selectSection("plugins"); }}
        />
      ),
    [t, sessions, sidebarState, sessionStatuses],
  );
  const rail = useCallback(
    (nav: AppShellNav) =>
      nav.view === "settings" ? (
        <SettingsRail t={t} section={nav.section} onSelect={nav.selectSection} onBack={nav.backToChat} />
      ) : (
        <NavRail
          logo={{ src: logoUrl, alt: "InnocenceHarness Logo", onClick: nav.expandNav }}
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

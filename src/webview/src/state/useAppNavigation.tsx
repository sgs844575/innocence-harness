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
  const [runningIds, setRunningIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const add = (sessionId: string) => setRunningIds((previous) => {
      const next = new Set(previous);
      next.add(sessionId);
      return next;
    });
    const remove = (sessionId: string) => setRunningIds((previous) => {
      if (!previous.has(sessionId)) return previous;
      const next = new Set(previous);
      next.delete(sessionId);
      return next;
    });
    const offDelta = api.onChatDelta((event) => add(event.sessionId));
    const offTool = api.onChatTool((event) => add(event.sessionId));
    const offThinking = api.onChatThinking((event) => add(event.sessionId));
    const offDone = api.onChatDone((event) => remove(event.sessionId));
    const offError = api.onChatError((event) => remove(event.sessionId));
    return () => {
      offDelta();
      offTool();
      offThinking();
      offDone();
      offError();
    };
  }, []);

  useEffect(() => {
    const ids = new Set(sessions.sessions.map((session) => session.id));
    setRunningIds((previous) => {
      const next = new Set([...previous].filter((id) => ids.has(id)));
      return next.size === previous.size ? previous : next;
    });
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
          runningIds={runningIds}
          onSelect={(id) => { nav.closeDrawerOnNavigate(); sessions.selectSession(id); }}
          onNew={() => { nav.closeDrawerOnNavigate(); sessions.newSession(); }}
          onDelete={(id) => void sessions.deleteSession(id)}
          onArchive={(id) => void sidebarState.archiveSession(id, !sidebarState.state.archived[id])}
          onOpenSettings={nav.openSettings}
        />
      ),
    [t, sessions, sidebarState, runningIds],
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

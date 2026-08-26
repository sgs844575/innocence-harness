import { useCallback, useEffect, useMemo, useReducer } from "react";
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
import { useSessionActivityProjection } from "./sessionActivityProjection";
import { WORKSPACE_PRESENTATION_STORAGE_KEY, persistWorkspacePresentationState, reduceWorkspacePresentationState, restoreWorkspacePresentationState } from "./workspacePresentationState";
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
  const sessionIds = useMemo(() => sessions.sessions.map((session) => session.id), [sessions.sessions]);
  const activeArchived = sessions.activeId !== null && sidebarState.state.archived[sessions.activeId] === true;
  const { statuses: sessionStatuses, status: activeSessionStatus } = useSessionActivityProjection(
    sessions.activeId,
    activeArchived,
    sessionIds,
  );
  const [presentation, dispatchPresentation] = useReducer(
    reduceWorkspacePresentationState,
    undefined,
    () => typeof window === "undefined"
      ? restoreWorkspacePresentationState(null)
      : restoreWorkspacePresentationState(window.localStorage.getItem(WORKSPACE_PRESENTATION_STORAGE_KEY)),
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(WORKSPACE_PRESENTATION_STORAGE_KEY, persistWorkspacePresentationState(presentation));
    }
  }, [presentation]);

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
          onSearch={nav.openSearch}
          onAutomation={nav.openAutomation}
          onPlugins={() => { nav.openSettings(); nav.selectSection("plugins"); }}
          view={presentation.sidebarView}
          collapsedProjectIds={presentation.collapsedProjectIds}
          onViewChange={(view) => dispatchPresentation({ type: "sidebar/view", view })}
          onToggleProject={(projectId) => dispatchPresentation({ type: "sidebar/project-toggle", projectId })}
        />
      ),
    [t, sessions, sidebarState, sessionStatuses, presentation],
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
  return {
    sidebar,
    rail,
    settingsView,
    activeArchived,
    activeSessionStatus,
    selectedFilePath: presentation.selectedFilePath,
    selectFile: (path: string | undefined) => dispatchPresentation({ type: "file/select", path }),
  };
}

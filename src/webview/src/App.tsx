// App 组装层：settings/sessions/chat/sidebar 状态接线，外壳三视图
// （chat/settings/automation）+ 搜索浮层 + 错误 toast。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppInfo, ThemeMode } from "../../shared/ipc";
import type { HarnessSettingsPatch } from "../../shared/settingsPatch";
import { api, hasBridge } from "./lib/ipc";
import { createT } from "./lib/i18n";
import { applyTheme } from "./lib/theme";
import { AppShell, type ShellView } from "./components/AppShell";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { Landing } from "./components/Landing";
import { ChatView } from "./components/ChatView";
import { SettingsView, type SettingsSection } from "./components/SettingsView";
import { SettingsSidebar } from "./components/SettingsSidebar";
import { AutomationView } from "./components/AutomationView";
import { SearchDialog } from "./components/SearchDialog";
import { useSessions, projectName } from "./state/useSessions";
import { useChatStream } from "./state/useChatStream";
import { useSettings } from "./state/useSettings";
import { useSidebarState } from "./state/useSidebarState";
import { useSubagentRuns } from "./state/useSubagentRuns";
import { runByInvocation, runsForSession } from "./state/subagentRuns";
import { RightDock } from "./components/RightDock";
import { clampDockWidth, DEFAULT_DOCK_WIDTH, type DockFilePayload, type DockTabInstance, type DockTabKind } from "./state/dockTabs";
import { AuxChatView } from "./components/AuxChatView";
import { ReviewView } from "./components/ReviewView";
import { DockTerminalView } from "./components/DockTerminalView";
import { TerminalPanel } from "./components/TerminalPanel";
import { BrowserView } from "./components/BrowserView";
import { latestTodos, type ToolRowModel } from "./components/chat/toolRows";
import type { ComposerDraft } from "./components/Composer";
import type { GitCapsuleData } from "./components/GitCapsule";
import { BranchPicker } from "./components/BranchPicker";
import { AppMenu } from "./components/AppMenu";
import type { TitleBarMenuItem } from "./components/TitleBar";

const APP_NAME = "InnocenceHarness";
/** 「…」菜单「反馈问题」入口。 */
const ISSUES_URL = "https://github.com/sgs844575/innocence-code/issues";

export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark");
  const { settings, patch } = useSettings();
  const sessions = useSessions();
  const sidebar = useSidebarState();
  const [view, setView] = useState<ShellView>("chat");
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draft, setDraft] = useState<ComposerDraft | undefined>(undefined);

  const lang = settings?.locale || appInfo?.locale || "zh-CN";
  const t = useMemo(() => createT(lang), [lang]);

  const showError = useCallback((message: string) => {
    setError(message);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4000);
  }, []);

  const chat = useChatStream({
    activeId: sessions.activeId,
    ensureSessionForSend: sessions.ensureSessionForSend,
    onError: (kind) =>
      showError(
        t(
          kind === "createSession"
            ? "chat.error.createSession"
            : kind === "resendFailed"
              ? "chat.error.resendFailed"
              : "chat.error.sendFailed",
        ),
      ),
  });

  // 右侧 dock：多标签（子代理 + 辅助对话实例 + 审查 + 文件预览）+ 可拖宽度 + 运行实况；
  // 新运行自动打开一次并直达子代理标签（可发现性）；时间线工具行点入定位。
  const { state: subagentRunsState, hydrate: hydrateSubagentRuns } = useSubagentRuns();
  const subagentStateRef = useRef(subagentRunsState);
  subagentStateRef.current = subagentRunsState;
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTabs, setDockTabs] = useState<DockTabInstance[]>([]);
  const [activeDockTabId, setActiveDockTabId] = useState<string | null>(null);
  const dockTabsRef = useRef(dockTabs);
  dockTabsRef.current = dockTabs;
  const nextTerminalSeqRef = useRef(0);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [dockWidth, setDockWidth] = useState(() => {
    const saved = Number(localStorage.getItem("rightDockWidth"));
    return Number.isFinite(saved) && saved > 0 ? clampDockWidth(saved) : DEFAULT_DOCK_WIDTH;
  });
  const [dockResizing, setDockResizing] = useState(false);
  const dockWidthRef = useRef(dockWidth);
  dockWidthRef.current = dockWidth;
  const activeRuns = useMemo(
    () => runsForSession(subagentRunsState, sessions.activeId),
    [subagentRunsState, sessions.activeId],
  );
  /** 有档案的 Task 调用集合：时间线 Task 行据此决定「开面板」还是退化为
   *  可展开行（档案缺失时至少给只读 final/error 详情）。 */
  const subagentInvocations = useMemo(
    () =>
      new Set(
        Object.values(subagentRunsState)
          .map((run) => run.parentInvocationId)
          .filter((id): id is string => id !== undefined),
      ),
    [subagentRunsState],
  );
  // 重启/切会话后按会话回放落盘档案（实况优先），面板历史由此可再查看。
  useEffect(() => {
    if (!hasBridge() || sessions.activeId === null) return;
    let cancelled = false;
    api
      .listSubagentHistory(sessions.activeId)
      .then((entries) => {
        if (!cancelled) hydrateSubagentRuns(entries);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessions.activeId, hydrateSubagentRuns]);

  /** 打开/激活某类 dock 标签：subagents/review 单例；aux 建标签即建 aux 会话。 */
  const newDockTab = useCallback(
    (kind: DockTabKind) => {
      setDockOpen(true);
      if (kind === "subagents" || kind === "review") {
        setDockTabs((tabs) =>
          tabs.some((tab) => tab.id === kind)
            ? tabs
            : [...tabs, { id: kind, kind, createdAt: Date.now() }],
        );
        setActiveDockTabId(kind);
        return;
      }
      // aux：项目根沿用主会话（无激活会话时取落地态选择），aux 标记不进侧边栏。
      // 标题编号由 dock 按存活 aux 标签动态推导（会话标题仅作内部标识）。
      const root =
        sessions.sessions.find((session) => session.id === sessions.activeId)?.workspaceRoot?.trim() ||
        sessions.pendingProject.trim();
      if (kind === "terminal") {
        // 终端：一标签一 PTY（多实例），标题 = 项目目录名；空根由主进程回退主目录。
        const tab: DockTabInstance = {
          id: `term_${Date.now().toString(36)}_${(nextTerminalSeqRef.current++).toString(36)}`,
          kind: "terminal",
          title: root ? projectName(root) : undefined,
          cwd: root,
          createdAt: Date.now(),
        };
        setDockTabs((tabs) => [...tabs, tab]);
        setActiveDockTabId(tab.id);
        return;
      }
      if (kind === "browser") {
        // 浏览器：多实例；标题随页面标题回写（缺省「浏览器」，见 updateDockTab）。
        const tab: DockTabInstance = {
          id: `browser_${Date.now().toString(36)}_${(nextTerminalSeqRef.current++).toString(36)}`,
          kind: "browser",
          createdAt: Date.now(),
        };
        setDockTabs((tabs) => [...tabs, tab]);
        setActiveDockTabId(tab.id);
        return;
      }
      void api
        .createSession({ title: t("dock.tile.chat"), workspaceRoot: root || undefined, aux: true })
        .then((session) => {
          const tab: DockTabInstance = {
            id: `aux:${session.id}`,
            kind: "aux",
            sessionId: session.id,
            createdAt: Date.now(),
          };
          setDockTabs((tabs) => [...tabs, tab]);
          setActiveDockTabId(tab.id);
        })
        .catch(() => showError(t("chat.error.createSession")));
    },
    [sessions.sessions, sessions.activeId, sessions.pendingProject, t, showError],
  );

  /** 关闭 dock 标签：aux 标签连同其会话删除（运行时资源由 sessionDelete 释放）。 */
  const closeDockTab = useCallback((id: string) => {
    const tab = dockTabsRef.current.find((candidate) => candidate.id === id);
    if (tab?.kind === "aux" && tab.sessionId) void api.deleteSession(tab.sessionId).catch(() => undefined);
    const next = dockTabsRef.current.filter((candidate) => candidate.id !== id);
    setDockTabs(next);
    setActiveDockTabId((current) => (current === id ? (next.at(-1)?.id ?? null) : current));
  }, []);

  /** 浏览器标签的页面标题/favicon 回写（chip 文案/图标）。 */
  const updateDockTab = useCallback((id: string, patch: Partial<Pick<DockTabInstance, "title" | "favicon">>) => {
    setDockTabs((tabs) => tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }, []);

  const seenRunsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const fresh = activeRuns.filter((run) => !seenRunsRef.current.has(run.childId));
    if (fresh.length === 0) return;
    seenRunsRef.current = new Set([...seenRunsRef.current, ...fresh.map((run) => run.childId)]);
    if (!dockOpen) setDockOpen(true);
    newDockTab("subagents");
  }, [activeRuns, dockOpen, newDockTab]);
  // 切会话清掉定位选择。
  useEffect(() => setSelectedChildId(null), [sessions.activeId]);

  const openSubagentRun = useCallback((invocationId: string) => {
    newDockTab("subagents");
    const match = runByInvocation(subagentStateRef.current, invocationId);
    setSelectedChildId(match?.childId ?? null);
  }, [newDockTab]);

  /** 胶囊「智能体」行：打开 dock 子代理标签并选中最新存活运行（无存活选最近一次）实时展示。 */
  const openCapsuleSubagents = useCallback(() => {
    newDockTab("subagents");
    const runs = runsForSession(subagentStateRef.current, sessions.activeId);
    const live = runs.find((run) => run.endedAt === undefined) ?? runs.at(-1);
    setSelectedChildId(live?.childId ?? null);
  }, [newDockTab, sessions.activeId]);

  /** 顶栏终端钮：开合聊天页底部终端面板（右侧 dock 的终端标签走 dock 首页/＋ 菜单）。 */
  const [terminalPanelOpen, setTerminalPanelOpen] = useState(false);
  const toggleTerminalPanel = useCallback(() => setTerminalPanelOpen((value) => !value), []);
  /** 底部面板内存活的终端数（TerminalPanel 上报；收合不杀 shell，仍计为存活）。 */
  const [panelTerminalCount, setPanelTerminalCount] = useState(0);
  const handlePanelTerminalsChange = useCallback((count: number) => setPanelTerminalCount(count), []);

  /** 胶囊「终端」行：底部面板有存活终端 → 展开面板实时展示；否则激活 dock 终端标签。 */
  const openCapsuleTerminals = useCallback(() => {
    if (panelTerminalCount > 0) {
      setTerminalPanelOpen(true);
      return;
    }
    const firstTerminal = dockTabsRef.current.find((tab) => tab.kind === "terminal");
    if (firstTerminal) {
      setActiveDockTabId(firstTerminal.id);
      setDockOpen(true);
    }
  }, [panelTerminalCount]);

  /** 时间线文件行：在 dock 打开/刷新该文件的标签（编辑/写入 = 修改内容，读取 = 原文）。 */
  const openDockFile = useCallback((row: ToolRowModel) => {
    if (!row.filePath) return;
    const id = `file:${row.filePath}`;
    const file: DockFilePayload = {
      path: row.filePath,
      diff: row.diff,
      originalText: row.verbKey === "tool.verb.read" ? row.resultText : undefined,
    };
    setDockOpen(true);
    setDockTabs((tabs) =>
      tabs.some((tab) => tab.id === id)
        ? tabs.map((tab) => (tab.id === id ? { ...tab, file } : tab))
        : [...tabs, { id, kind: "file", file, createdAt: Date.now() }],
    );
    setActiveDockTabId(id);
  }, []);

  /** 侧栏文件树点文件：读取内容后在 dock 打开文件标签（二进制 → 空内容占位）。 */
  const openProjectFile = useCallback((root: string, rel: string) => {
    if (!hasBridge()) return;
    void api
      .readWorkspaceFile(root, rel)
      .then((result) => {
        const absolute = `${root.replace(/[\\/]+$/, "")}/${rel}`;
        const file: DockFilePayload = {
          path: absolute,
          originalText: result.binary ? "" : result.content,
        };
        const id = `file:${absolute}`;
        setDockOpen(true);
        setDockTabs((tabs) =>
          tabs.some((tab) => tab.id === id)
            ? tabs.map((tab) => (tab.id === id ? { ...tab, file } : tab))
            : [...tabs, { id, kind: "file", file, createdAt: Date.now() }],
        );
        setActiveDockTabId(id);
      })
      .catch(() => undefined);
  }, []);

  /** dock 左缘拖拽调宽：右锚定布局，指针左移 = 变宽；抬起时持久化。 */
  const handleDockResizeStart = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = dockWidthRef.current;
    setDockResizing(true);
    document.body.style.userSelect = "none";
    const onMove = (move: PointerEvent) => {
      setDockWidth(clampDockWidth(startWidth + (startX - move.clientX)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      setDockResizing(false);
      document.body.style.userSelect = "";
      localStorage.setItem("rightDockWidth", String(dockWidthRef.current));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  useEffect(() => {
    if (!hasBridge()) return;
    void api.getAppInfo().then(setAppInfo).catch(() => undefined);
    void api.getTheme().then(({ resolved }) => { applyTheme(resolved); setResolvedTheme(resolved); }).catch(() => undefined);
    return api.onThemeChanged((_mode, resolved) => { applyTheme(resolved); setResolvedTheme(resolved); });
  }, []);

  // 外观设置注入渲染层：界面/代码字号（根变量）与代码长行换行（根类）。
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--font-size-ui", `${settings?.uiFontSize ?? 14}px`);
    root.style.setProperty("--font-size-code", `${settings?.codeFontSize ?? 14}px`);
    root.classList.toggle("code-wrap", settings?.codeWordWrap === true);
  }, [settings?.uiFontSize, settings?.codeFontSize, settings?.codeWordWrap]);

  const patchSettings = useCallback(
    (next: HarnessSettingsPatch) => {
      void patch(next).catch(() => showError(t("chat.error.sendFailed")));
    },
    [patch, showError, t],
  );

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      patchSettings({ themeMode: mode });
      if (hasBridge()) void api.setTheme(mode).catch(() => undefined);
    },
    [patchSettings],
  );

  // 落地页分支胶囊：探测落地态选中项目根的分支。
  const [landingBranch, setLandingBranch] = useState<string | null>(null);
  useEffect(() => {
    const root = sessions.pendingProject.trim();
    if (!hasBridge() || root === "") {
      setLandingBranch(null);
      return;
    }
    let cancelled = false;
    void api
      .workspaceGitBranch(root)
      .then((branch) => {
        if (!cancelled) setLandingBranch(branch);
      })
      .catch(() => {
        if (!cancelled) setLandingBranch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessions.pendingProject]);

  // Git 浮动面板：会话根（回落全局工作区）的分支 + 更改统计；流式结束后刷新。
  const activeSession = sessions.sessions.find((session) => session.id === sessions.activeId);
  const sessionRoot = activeSession?.workspaceRoot?.trim() || settings?.workspaceRoot?.trim() || "";
  // 标题栏项目/分支胶囊只反映会话自身绑定的项目（不回落全局工作区），与侧边栏
  // 「任务」分组口径一致；Git 胶囊/终端/审查仍用 sessionRoot（agent 实际工作目录）。
  const titleProjectRoot = activeSession?.workspaceRoot?.trim() ?? "";
  const [capsuleGit, setCapsuleGit] = useState<Pick<GitCapsuleData, "branch" | "changes">>({ branch: null });
  // 分支面板检出成功后自增，驱动 Git 数据重拉。
  const [gitTick, setGitTick] = useState(0);
  useEffect(() => {
    if (!hasBridge() || sessionRoot === "") {
      setCapsuleGit({ branch: null });
      return;
    }
    let cancelled = false;
    void api.workspaceGitBranch(sessionRoot).then((branch) => {
      if (!cancelled) setCapsuleGit((current) => ({ ...current, branch }));
    }).catch(() => undefined);
    void api.workspaceGitChanges(sessionRoot).then((changes) => {
      // 非 Git 仓库返回 null 也要落（清掉上一仓库的残留统计），否则
      // 切换项目后 isGitRepo 会被旧数据钉住。
      if (!cancelled) setCapsuleGit((current) => ({ ...current, changes: changes ?? undefined }));
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionRoot, sessions.activeId, chat.streaming, gitTick]);

  const capsule: GitCapsuleData = useMemo(() => {
    const running = activeRuns.filter((run) => run.endedAt === undefined).length;
    const terminalCount = panelTerminalCount + dockTabs.filter((tab) => tab.kind === "terminal").length;
    return {
      branch: capsuleGit.branch,
      // 空仓（无提交）branch 为 null 但 changes 可统计——两者皆空才视为非 Git。
      isGitRepo: capsuleGit.branch !== null || capsuleGit.changes !== undefined,
      changes: capsuleGit.changes,
      todos: latestTodos(chat.messages),
      ...(activeRuns.length > 0 ? { subagents: { total: activeRuns.length, running } } : {}),
      ...(terminalCount > 0 ? { terminals: { count: terminalCount } } : {}),
      onOpenSubagents: openCapsuleSubagents,
      onOpenTerminals: openCapsuleTerminals,
    };
  }, [capsuleGit, chat.messages, activeRuns, dockTabs, panelTerminalCount, openCapsuleSubagents, openCapsuleTerminals]);

  const runningIds = useMemo<ReadonlySet<string>>(
    () => new Set(chat.streaming && sessions.activeId ? [sessions.activeId] : []),
    [chat.streaming, sessions.activeId],
  );

  const landing = sessions.activeId === null;
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const openSettings = useCallback(() => {
    setSettingsSection("general");
    setView("settings");
  }, []);
  // 「管理模型」入口直达模型分区。
  const openModelSettings = useCallback(() => {
    setSettingsSection("models");
    setView("settings");
  }, []);

  // 应用菜单/Ctrl+O「打开工作区」：选目录后落回落地态并绑定该项目；取消不动。
  const openWorkspace = useCallback(async () => {
    if (!hasBridge()) return;
    const dir = await sessions.pickProjectDir();
    if (!dir) return;
    sessions.newSession();
    setView("chat");
  }, [sessions]);

  // 分组「⊕」/空分组提示：建空会话并归入该组（项目根沿用当前会话/落地态选择）。
  const newSessionInGroup = useCallback(
    async (groupId: string) => {
      if (!hasBridge()) return;
      const root = sessionRoot || sessions.pendingProject.trim();
      const session = await api
        .createSession({ title: t("sidebar.nav.newChat"), workspaceRoot: root || undefined })
        .catch(() => null);
      if (!session) return;
      await api.moveSession(session.id, { kind: "group", groupId }).catch(() => undefined);
      sessions.selectSession(session.id);
      setView("chat");
    },
    [sessionRoot, sessions, t],
  );

  // 「…」菜单「复制任务/日志路径」：main 侧现取产物路径后写剪贴板。
  const copySessionPath = useCallback(
    (kind: "taskPath" | "logPath") => {
      if (!hasBridge() || !activeSession) return;
      void api
        .getSessionPaths(activeSession.id)
        .then((paths) => {
          const value = paths[kind];
          if (value) void navigator.clipboard?.writeText(value).catch(() => undefined);
        })
        .catch(() => undefined);
    },
    [activeSession],
  );

  const titleMenuItems: TitleBarMenuItem[] | undefined = useMemo(() => {
    if (landing || !activeSession) return undefined;
    const soon = t("titlebar.menu.comingSoon");
    return [
      { id: "pin", label: t("titlebar.menu.pin"), disabled: true, description: soon },
      { id: "rename", label: t("titlebar.menu.rename"), disabled: true, description: soon },
      { id: "archive", label: t("titlebar.menu.archive"), onSelect: () => void sidebar.archive(activeSession.id) },
      { id: "markUnread", label: t("titlebar.menu.markUnread"), disabled: true, description: soon },
      {
        id: "openExplorer",
        label: t("titlebar.menu.openExplorer"),
        separatorBefore: true,
        disabled: sessionRoot === "",
        onSelect: () => void api.revealPath(sessionRoot).catch(() => undefined),
      },
      {
        id: "copyPath",
        label: t("titlebar.menu.copyPath"),
        disabled: sessionRoot === "",
        onSelect: () => void navigator.clipboard?.writeText(sessionRoot).catch(() => undefined),
      },
      { id: "copyTaskPath", label: t("titlebar.menu.copyTaskPath"), onSelect: () => copySessionPath("taskPath") },
      { id: "copyLogPath", label: t("titlebar.menu.copyLogPath"), onSelect: () => copySessionPath("logPath") },
      {
        id: "copySessionId",
        label: t("titlebar.menu.copySessionId"),
        onSelect: () => void navigator.clipboard?.writeText(activeSession.id).catch(() => undefined),
      },
      { id: "goSettings", label: t("titlebar.menu.goSettings"), onSelect: openSettings },
      { id: "viewTrace", label: t("titlebar.menu.viewTrace"), separatorBefore: true, disabled: true, description: soon },
      {
        id: "feedback",
        label: t("titlebar.menu.feedback"),
        onSelect: () => void api.openExternal(ISSUES_URL).catch(() => undefined),
      },
    ];
  }, [landing, activeSession, t, sessionRoot, sidebar, copySessionPath, openSettings]);

  return (
    <AppShell
      view={view}
      onViewChange={setView}
      onNewSession={sessions.newSession}
      onOpenSearch={() => setSearchOpen(true)}
      onOpenWorkspace={() => void openWorkspace()}
      toast={error}
      dock={
        <RightDock
          t={t}
          tabs={dockTabs}
          activeTabId={activeDockTabId}
          code={{
            light: settings?.codeThemeLight ?? "github-light",
            dark: settings?.codeThemeDark ?? "github-dark",
            lineNumbers: settings?.codeLineNumbers !== false,
          }}
          onActivateTab={setActiveDockTabId}
          onCloseTab={closeDockTab}
          onNewTab={newDockTab}
          runs={activeRuns}
          selectedChildId={selectedChildId}
          onSelect={setSelectedChildId}
          renderAuxTab={(tab) => (
            <AuxChatView
              t={t}
              sessionId={tab.sessionId ?? ""}
              settings={settings}
              onPatchSettings={patchSettings}
              onManageModels={openModelSettings}
              onError={showError}
            />
          )}
          renderReviewTab={() => (
            <ReviewView
              t={t}
              workspaceRoot={sessionRoot}
              reloadSignal={`${gitTick}:${chat.streaming}`}
              loadFiles={(root, scope) => api.workspaceGitReviewFiles(root, scope)}
              loadDiff={(root, scope, relPath) => api.workspaceGitReviewDiff(root, scope, relPath)}
            />
          )}
          renderTerminalTab={(tab) => (
            <DockTerminalView
              t={t}
              terminalId={tab.id}
              workspaceRoot={tab.cwd ?? ""}
              visible={tab.id === activeDockTabId}
              fontSize={settings?.codeFontSize}
            />
          )}          renderBrowserTab={(tab) => (
            <BrowserView
              t={t}
              onTitleChange={(title, favicon) =>
                updateDockTab(tab.id, {
                  ...(title ? { title } : {}),
                  ...(favicon ? { favicon } : {}),
                })
              }
            />
          )}
          onResizeStart={handleDockResizeStart}
        />
      }
      dockOpen={dockOpen}
      dockWidth={dockWidth}
      dockResizing={dockResizing}
      titleBar={(nav) => (
        <TitleBar
          t={t}
          platform={appInfo?.platform}
          sidebarOpen={nav.sidebarOpen}
          onToggleSidebar={nav.toggleSidebar}
          landing={landing || view !== "chat"}
          title={activeSession?.title ?? ""}
          project={titleProjectRoot ? projectName(titleProjectRoot) : ""}
          branch={landing || view !== "chat" || titleProjectRoot === "" ? null : capsuleGit.branch}
          branchSlot={
            landing || view !== "chat" || titleProjectRoot === "" ? undefined : (
              <BranchPicker
                t={t}
                root={titleProjectRoot}
                current={capsuleGit.branch}
                onSwitched={() => setGitTick((tick) => tick + 1)}
                onError={showError}
              />
            )
          }
          menuItems={titleMenuItems}
          appMenu={
            <AppMenu
              t={t}
              platform={appInfo?.platform}
              version={appInfo?.version}
              workspaceRoot={sessionRoot || sessions.pendingProject.trim()}
              onNewTask={() => {
                sessions.newSession();
                setView("chat");
              }}
              onOpenWorkspace={() => void openWorkspace()}
              onFeedback={hasBridge() ? () => void api.openExternal(ISSUES_URL).catch(() => undefined) : undefined}
              onError={showError}
            />
          }
          terminalActive={terminalPanelOpen}
          onToggleTerminal={toggleTerminalPanel}
          dockOpen={dockOpen}
          onToggleDock={() => setDockOpen((value) => !value)}
        />
      )}
      sidebar={
        view === "settings" ? (
          <SettingsSidebar
            t={t}
            section={settingsSection}
            onSelect={setSettingsSection}
            onBack={() => setView("chat")}
          />
        ) : (
          <Sidebar
            t={t}
            sessions={sessions.sessions}
            activeId={sessions.activeId}
            runningIds={runningIds}
            archived={sidebar.archived}
            groups={sidebar.groups}
            onSelect={(id) => {
              sessions.selectSession(id);
              setView("chat");
            }}
            onNew={() => {
              sessions.newSession();
              setView("chat");
            }}
            onDelete={(id) => void sessions.deleteSession(id).catch(() => undefined)}
            onArchive={(id) => void sidebar.archive(id)}
            onRestore={(id) => void sidebar.restore(id)}
            onOpenSettings={openSettings}
            onSearch={() => setSearchOpen(true)}
            onAutomation={() => setView("automation")}
            onPlugins={openSettings}
            onNewProject={hasBridge() ? () => void openWorkspace() : undefined}
            onNewTaskInProject={(root) => {
              sessions.setPendingProject(root);
              sessions.newSession();
              setView("chat");
            }}
            onOpenProjectFile={(root, rel) => openProjectFile(root, rel)}
            onRevealProject={
              hasBridge()
                ? (root) => void api.revealPath(root).catch(() => undefined)
                : undefined
            }
            groupActions={{
              createGroup: (name, color) => void sidebar.createGroup(name, color),
              moveSession: (id, groupId) => void sidebar.moveSessionTo(id, groupId),
              moveToTop: (groupId, sessionId) => void sidebar.moveGroupSessionToTop(groupId, sessionId),
              newSessionInGroup: (groupId) => void newSessionInGroup(groupId),
              deleteGroup: (groupId) => void sidebar.deleteGroup(groupId),
            }}
          />
        )
      }
      main={(nav) => {
        if (nav.view === "settings") {
          return (
            <SettingsView
              t={t}
              settings={settings}
              appInfo={appInfo}
              section={settingsSection}
              onPatchSettings={patchSettings}
              onSetTheme={setThemeMode}
              onSetApiKey={
                hasBridge()
                  ? (profileId, apiKey) => {
                      // 密钥落安全存储后重拉投影（apiKeyConfigured 标志刷新）。
                      void api
                        .setProviderApiKey(profileId, apiKey)
                        .then(() => patch({}))
                        .catch(() => showError(t("chat.error.sendFailed")));
                    }
                  : undefined
              }
              onFetchModels={
                hasBridge()
                  ? async (profile) => {
                      const ids = await api.listProviderModels(profile.id);
                      const enriched = await api.enrichModels(profile.name, ids).catch(() => []);
                      return enriched.length > 0
                        ? enriched
                        : ids.map((id) => ({ id, name: id, source: "fetch" as const }));
                    }
                  : undefined
              }
              onFeedback={
                hasBridge() ? () => void api.openExternal(ISSUES_URL).catch(() => undefined) : undefined
              }
              resolvedTheme={resolvedTheme}
            />
          );
        }
        if (nav.view === "automation") {
          return <AutomationView t={t} onBack={nav.backToChat} />;
        }
        if (landing) {
          return (
            <Landing
              t={t}
              appName={APP_NAME}
              pendingProject={sessions.pendingProject}
              branch={landingBranch}
              recentProjects={sessions.recentProjects}
              onPickProject={sessions.setPendingProject}
              onOpenProjectDir={() => void sessions.pickProjectDir()}
              settings={settings}
              streaming={chat.streaming}
              onPatchSettings={patchSettings}
              onSend={(text) => void chat.send(text)}
              onStop={() => void chat.stop()}
              draft={draft}
              onQuickPick={(prompt) => setDraft({ text: prompt, nonce: Date.now() })}
              onManageModels={openModelSettings}
            />
          );
        }
        return (
          <ChatView
            t={t}
            messages={chat.messages}
            streaming={chat.streaming}
            permission={chat.permission}
            settings={settings}
            onPatchSettings={patchSettings}
            onSend={(text) => void chat.send(text)}
            onEditResend={(messageId, text) => void chat.resend(messageId, text)}
            onStop={() => void chat.stop()}
            onPermissionRespond={(requestId, choice) => void chat.respondPermission(requestId, choice)}
            capsule={capsule}
            onManageModels={openModelSettings}
            onOpenSubagent={openSubagentRun}
            subagentInvocations={subagentInvocations}
            onOpenFile={openDockFile}
            terminalPanel={
              <TerminalPanel
                t={t}
                open={terminalPanelOpen}
                workspaceRoot={sessionRoot}
                fontSize={settings?.codeFontSize}
                onClose={() => setTerminalPanelOpen(false)}
                onTerminalsChange={handlePanelTerminalsChange}
              />
            }
          />
        );
      }}
      overlay={
        <SearchDialog
          t={t}
          open={searchOpen}
          sessions={sessions.sessions}
          commands={[
            {
              id: "new-task",
              label: t("sidebar.nav.newChat"),
              kbd: "Ctrl+N",
              onSelect: () => {
                sessions.newSession();
                setView("chat");
              },
            },
            { id: "automation", label: t("sidebar.nav.automation"), onSelect: () => setView("automation") },
            { id: "settings", label: t("sidebar.settings"), onSelect: () => setView("settings") },
          ]}
          onSelect={(id) => {
            sessions.selectSession(id);
            setView("chat");
          }}
          onClose={() => setSearchOpen(false)}
        />
      }
    />
  );
}

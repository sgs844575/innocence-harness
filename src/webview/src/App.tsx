// App — 组装层（Task 12 拆分后）。状态责任全部下沉：
//   useSessionController  会话选择/创建/删除与落地态项目
//   useChatStream         delta/tool/thinking/permission 流
//   useWorkbenchState     任务/路线/审查/冲突/恢复（纯 reducer + IPC 订阅）
//   AppShell              响应式导航与三态工作台布局
// 这里只保留跨切片的装配：settings/appInfo、语言、错误 toast、恢复横幅
// 与各面板的 props 接线。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppInfo, HarnessSettings } from "../../shared/ipc";
import type { TaskForkRouteRequest } from "../../shared/taskIpc";
import { api, taskApi } from "./lib/ipc";
import { createT } from "./lib/i18n";
import { TitleBar } from "./components/TitleBar";
import { ChatView } from "./components/ChatView";
import { AutomationView } from "./components/AutomationView";
import { GlobalSearchDialog } from "./components/GlobalSearchDialog";

import { AppShell, type AppShellNav } from "./components/AppShell";
import { BuiltinToolcards } from "./components/chat/toolcards/builtinToolcards";
import { BuiltinPanels } from "./components/workbench/builtinPanels";
import { BuiltinSettingsSections } from "./components/settings/builtinSettingsSections";
import { SlotProvider } from "./slots/react";
import { createSlotRegistry } from "./slots/registry";
import { ForkRouteDialog } from "./components/task/ForkRouteDialog";
import type { ForkMessageCommand } from "./components/MessageItem";
import { useSessionController } from "./state/useSessionController";
import { useChatStream } from "./state/useChatStream";
import { useWorkbenchState } from "./state/useWorkbenchState";
import { useTaskReviewData } from "./state/useTaskReviewData";
import { usePluginClients } from "./state/usePluginClients";
import { useWorkbenchPresentation } from "./state/useWorkbenchPresentation";
import type { WorkbenchTabId } from "./components/workbench/WorkbenchTabs";
import { useChatWorkspacePresentation } from "./state/useChatWorkspacePresentation";
import { useAppNavigation } from "./state/useAppNavigation";
import { writeToolsBlocked } from "./state/workbenchState";
import { createSettingsCommitter } from "./state/settingsCommitter";
import { useAgentModes } from "./state/agentModes";
import { diffSettingsSnapshot } from "../../shared/settingsPatch";

const APP_NAME = "InnocenceHarness";

export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<HarnessSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellNav = useRef<AppShellNav | null>(null);
  // 槽位注册表（App 持有）：视图钩子经 <SlotProvider registry> 消费；插件
  // client 装载器（命令式、非视图层）经同一实例注册工具卡（订阅通道重渲染）。
  const [slotRegistry] = useState(createSlotRegistry);
  const { pluginInventory, pluginInventoryError, refreshPluginInventory } = usePluginClients(slotRegistry);

  // Persisted locale wins; fall back to the system locale, then zh-CN.
  const lang = settings?.locale || appInfo?.locale || "zh-CN";
  const t = useMemo(() => createT(lang), [lang]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4000);
  }, []);

  useEffect(() => {
    void api.getAppInfo().then(setAppInfo);
    void api.getHarnessSettings().then(setSettings);
  }, []);

  // agent 模式目录（agents:modes 通道）：App 组装层拉取，经 props 下发 Composer。
  // refreshKey 接插件清单状态——清单每次刷新（初载 / plugins:changed 事件 /
  // 设置提交后的 refresh 链）都换新引用，模式目录随之同时机重拉。
  const agentModes = useAgentModes(api, pluginInventory);

  const commitSettingsPatch = useMemo(
    () => createSettingsCommitter({
      save: api.setHarnessSettings,
      apply: setSettings,
      refresh: refreshPluginInventory,
      onError: (err) => showError(`保存设置失败：${(err as Error).message.slice(0, 120)}`),
    }),
    [refreshPluginInventory, showError],
  );

  /** 设置补丁始终由主进程基于最新已提交 settings 合并。 */
  const applySettingsPatch = useCallback((patch: Partial<HarnessSettings>) => {
    void commitSettingsPatch(patch).catch(() => undefined);
  }, [commitSettingsPatch]);

  /** Existing full-shape settings callers are converted to a rebasable mutation before IPC. */
  const handleSettingsSet = useCallback((next: HarnessSettings) => {
    if (!settings) return;
    void commitSettingsPatch(diffSettingsSnapshot(settings, next)).catch(() => undefined);
  }, [commitSettingsPatch, settings]);

  const handlePickWorkspace = useCallback(async () => {
    const dir = await api.pickWorkspace();
    if (dir) applySettingsPatch({ workspaceRoot: dir });
  }, [applySettingsPatch]);

  const sessions = useSessionController({ settings, onSettingsChange: applySettingsPatch, showError, t });

  const workbench = useWorkbenchState({ sessionId: sessions.activeId });
  const task = workbench.state.task;

  // 会话激活 → 探测该会话的任务并装载工作台（create=false：仅打开会话不
  // 新建任务；任务在首条消息发送时创建，见 useChatStream.ensureTask）。
  useEffect(() => {
    if (sessions.activeId !== null) void workbench.ensureTask(sessions.activeId, false);
  }, [sessions.activeId, workbench.ensureTask]);

  // 恢复门禁：事件回放/worktree 失败未解决前禁止新的写回合。
  const sendGate = useCallback(
    () => (writeToolsBlocked(workbench.state) ? t("workbench.sendBlocked") : null),
    [workbench.state, t],
  );

  // 审查面数据源（C3）：task:changes 状态化 hunks + code:list-files 文件树。
  const reviewData = useTaskReviewData({
    taskId: task?.taskId ?? "",
    routeId: workbench.state.activeRouteId,
  });
  const { sidebar, settingsView, activeSessionStatus, subagents, selectedFilePath, selectFile } = useAppNavigation({
    t,
    sessions,
    settings,
    appInfo,
    onSettingsChange: handleSettingsSet,
    onPickWorkspace: () => void handlePickWorkspace(),
  });
  const [terminalActivity, setTerminalActivity] = useState({ durationMs: 0, backgroundTasks: 0 });
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const openSubagentPanel = useCallback((childId: string) => {
    setSelectedSubagentId(childId);
    shellNav.current?.workbench.setTab("assistant");
    shellNav.current?.workbench.setOpen(true);
  }, []);
  const selectedSubagent = selectedSubagentId === null
    ? null
    : (subagents.get(`${sessions.activeId ?? ""}:${selectedSubagentId}`) ?? null);
  const { workbenchPanels, banner } = useWorkbenchPresentation({
    t,
    workbench,
    reviewData,
    onTerminalActivityChange: setTerminalActivity,
    showError,
    onCloseTerminal: () => shellNav.current?.workbench.setOpen(false),
    selectedSubagent,
    selectedFilePath,
    onSelectFile: selectFile,
    onSelectTab: (tab: WorkbenchTabId) => {
      shellNav.current?.workbench.setTab(tab);
      shellNav.current?.workbench.setOpen(true);
    },
  });

  const openReviewPanel = useCallback(() => {
    shellNav.current?.workbench.setTab("review");
    shellNav.current?.workbench.setOpen(true);
  }, []);
  const openTerminalPanel = useCallback(() => {
    shellNav.current?.workbench.openTerminal();
  }, []);

  // 分叉入口（C3）：消息操作 → ForkRouteDialog → task:fork-route；创建成功
  // 后切换路线并把分叉 prompt 发到新路线（send 走 main 侧会话绑定）。
  const [forkDialog, setForkDialog] = useState<{ request: TaskForkRouteRequest; checkpointId: string } | null>(null);
  const handleForkMessage = useCallback(
    (command: ForkMessageCommand) => {
      if (!task) return;
      const sourceRouteId = workbench.state.activeRouteId;
      setForkDialog({
        request: {
          sessionId: task.sessionId,
          taskId: task.taskId,
          sourceRouteId,
          sourceTurnId: command.turnId,
          mode: command.mode,
          ...(command.mode === "edit-user" ? { editedText: command.text } : {}),
          routeName: command.mode === "edit-user" ? `Edit ${command.turnId}` : `Retry ${command.turnId}`,
        },
        checkpointId: task.routes.find((route) => route.routeId === sourceRouteId)?.checkpointId ?? "",
      });
    },
    [task, workbench.state.activeRouteId],
  );

  // M1 会话 fork（非任务会话）：按用户消息切口分叉出新会话并切换过去；
  // 任务会话不挂此入口（已有路线分叉 + 工作树语义，避免双分叉口径）。
  // worktree 模式（A:95）：父 Git 工作区自 HEAD 建分离工作树并绑定为新
  // 会话根——父工作树因根切换天然禁入。
  const handleForkSession = useCallback(
    async (messageId: string, mode?: "text" | "worktree") => {
      const activeId = sessions.activeId;
      if (!activeId) return;
      const worktree = mode === "worktree";
      try {
        const forked = await api.forkSession(
          activeId,
          worktree ? { upToMessageId: messageId, worktree: true } : { upToMessageId: messageId },
        );
        if (forked) {
          sessions.selectSession(forked.id);
        } else {
          showError(t(worktree ? "chat.forkWorktreeFailed" : "chat.forkFailed"));
        }
      } catch {
        showError(t(worktree ? "chat.forkWorktreeFailed" : "chat.forkFailed"));
      }
    },
    [sessions, showError, t],
  );

  // S1 后台作业：输入框"后台运行"——新建后台会话机器身份触发一次自含
  // 运行；不切换会话（保持当前焦点），落定后走状态驱动通知。作业会话绑定
  // 当前会话的项目根（回调内现取——声明序在 activeSession 之前；无则回落
  // 全局设置根，与会话创建同语义）。
  const handleBackgroundRun = useCallback(
    async (text: string) => {
      const currentRoot =
        sessions.sessions.find((s) => s.id === sessions.activeId)?.workspaceRoot?.trim() || "";
      const workspaceRoot = currentRoot || sessions.pendingProject?.trim() || undefined;
      try {
        await api.startBackgroundJob(text, workspaceRoot ? { workspaceRoot } : undefined);
        showError(t("chat.backgroundStarted"));
      } catch {
        showError(t("chat.backgroundFailed"));
      }
    },
    [sessions, showError, t],
  );

  const chat = useChatStream({
    activeId: sessions.activeId,
    ensureSession: sessions.ensureSessionForSend,
    ensureTask: workbench.ensureTask,
    showError,
    t,
    sendGate,
  });
  const workspacePresentation = useChatWorkspacePresentation({
    messages: chat.messages,
    streaming: chat.streaming,
    task,
    sessionId: sessions.activeId,
    activeRouteId: workbench.state.activeRouteId,
    hunks: reviewData.hunks,
    changedFiles: reviewData.changedFiles,
    terminal: terminalActivity,
    agentName: settings?.activeAgentMode ?? "default",
    sessionStatus: activeSessionStatus,
    subagents,
    onOpenSubagent: openSubagentPanel,
    onCompare: openReviewPanel,
    onOpenProcess: openReviewPanel,
    onOpenTerminal: openTerminalPanel,
  });

  const handleForkSwitched = useCallback(
    async (routeId: string, prompt: string) => {
      if (!task) return;
      await workbench.switchRoute({ taskId: task.taskId, routeId });
      await reviewData.refresh();
      await chat.send(prompt);
    },
    [task, workbench, reviewData, chat],
  );

  // Native menu "New Session" shortcut — leaves settings, dismisses the
  // overlay drawer, and returns to the landing chat state.
  useEffect(() => {
    const off = api.onMenuNewSession(() => {
      shellNav.current?.backToChat();
      shellNav.current?.closeDrawerOnNavigate();
      sessions.newSession();
    });
    return off;
  }, [sessions.newSession]);

  // TitleBar 状态簇：项目取当前会话（回落全局工作区）；路线与 Git branch
  // 来自任务上下文的真实 DTO（无任务时隐藏）。
  const activeSession = sessions.sessions.find((session) => session.id === sessions.activeId);
  const workspaceRoot = activeSession?.workspaceRoot ?? settings?.workspaceRoot ?? "";
  const projectName =
    workspaceRoot === "" ? "" : (workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? "");

  return (
    <SlotProvider registry={slotRegistry}>
      {/* 槽位宿主：内置工具卡/工作台面板/设置分区各注册一次，供全树经槽位消费 */}
      <BuiltinToolcards />
      <BuiltinPanels panels={workbenchPanels} />
      <BuiltinSettingsSections
        deps={{
          t,
          settings,
          appInfo,
          onSettingsChange: handleSettingsSet,
          onPickWorkspace: () => void handlePickWorkspace(),
          pluginInventory,
          pluginInventoryError,
        }}
      />
      <AppShell
        t={t}
        bindNav={(nav) => {
          shellNav.current = nav;
        }}
        titleBar={(nav) => (
          <TitleBar
            sidebarOpen={nav.sidebarOpen}
            onToggleSidebar={nav.toggleSidebar}
            onNewSession={() => { nav.closeDrawerOnNavigate(); sessions.newSession(); }}
            landing={sessions.activeId === null}
            title={activeSession?.title ?? ""}
            workbench={{
              project: projectName,
              routeId: task ? workbench.state.activeRouteId : null,
              gitBranch: task?.gitBranch ?? null,
            }}
            panelOpen={nav.workbench.open}
            onTogglePanel={nav.workbench.togglePanel}
            terminalOpen={nav.workbench.open && nav.workbench.tab === "terminal"}
            onToggleTerminal={nav.workbench.openTerminal}
            t={t}
          />
        )}
        sidebar={sidebar}
        banner={banner}
        toast={error}
        panels={workbenchPanels}
        search={(nav) => (
          <GlobalSearchDialog
            open={nav.searchOpen}
            onOpenChange={(open) => open ? nav.openSearch() : nav.closeSearch()}
            sessions={sessions.sessions}
            files={reviewData.files}
            actions={[
              { id: "new-task", label: "新建任务", onSelect: () => { nav.closeDrawerOnNavigate(); nav.backToChat(); sessions.newSession(); } },
              { id: "open-review", label: "打开审查", onSelect: () => { nav.closeDrawerOnNavigate(); openReviewPanel(); } },
              { id: "open-automation", label: "自动化", onSelect: () => { nav.closeDrawerOnNavigate(); nav.openAutomation(); } },
            ]}
            onSelectSession={(id) => { nav.closeDrawerOnNavigate(); nav.backToChat(); sessions.selectSession(id); }}
            onSelectFile={(path) => { nav.closeDrawerOnNavigate(); selectFile(path); nav.workbench.setTab("code"); nav.workbench.setOpen(true); }}
          />
        )}
        automation={<AutomationView
          onBack={() => shellNav.current?.backToChat()}
          sessionId={sessions.activeId ?? ""}
          taskId={task?.taskId}
          routeId={workbench.state.activeRouteId}
        />}
        chat={
          <ChatView
            t={t}
            appName={APP_NAME}
            activity={workspacePresentation.activity}
            messages={chat.messages}
            streaming={chat.streaming}
            settings={settings}
            agentModes={agentModes}
            permission={chat.permission}
            onSettingsChange={applySettingsPatch}
            onPermissionRespond={chat.respondPermission}
            onSend={(text) => void chat.send(text)}
            onStop={chat.stop}
            landing={sessions.activeId === null}
            pendingProject={sessions.pendingProject}
            onPickProject={sessions.setPendingProject}
            recentProjects={sessions.recentProjects}
            onOpenProjectDir={() => void sessions.pickProjectDir()}
            taskChanges={workspacePresentation.taskChanges}
            onOpenTaskReview={openReviewPanel}
            onOpenReview={openReviewPanel}
            onForkMessage={task ? handleForkMessage : undefined}
            onForkSession={
              task ? undefined : (messageId, mode) => void handleForkSession(messageId, mode)
            }
            onBackgroundRun={(text) => void handleBackgroundRun(text)}
          />
        }
        settings={settingsView}
      />
      {forkDialog && (
        <ForkRouteDialog
          open
          request={forkDialog.request}
          checkpointId={forkDialog.checkpointId}
          onClose={() => setForkDialog(null)}
          createRoute={(request) => taskApi.forkRoute(request)}
          onSwitchRoute={(routeId, prompt) => void handleForkSwitched(routeId, prompt)}
        />
      )}
    </SlotProvider>
  );
}

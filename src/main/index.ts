// InnocenceHarness main entry: single-instance lock, protocol registration,
// then window.
import { app, Menu, session } from "electron";
import path from "node:path";
import {
  handleAppScheme,
  handlePluginScheme,
  registerAppScheme,
  registerPluginScheme,
} from "./protocol";
import {
  bindSessionTaskRoute,
  handleWorkbenchFocusNotice,
  applyHostSettingsSideEffects,
  bootPaths,
  getHarnessSettings,
  getTaskBridge,
  getTaskStorageDir,
  initHarness,
  isSessionRunning,
  startAutomationLifecycle,
  disposeAllRuntime,
  disposeAutomationLifecycle,
  disposeTelemetry,
  disposePluginBoot,
  disposeTaskRuntime,
  rejectPendingPermissionAsks,
  resolveRouteWorkspaceRoot,
} from "./harnessGlue";
import { defaultUserPluginRoot } from "./pluginBoot/compose";
import { createMainWindow, getMainWindow } from "./appWindow";
import { createMainAppLifecycle } from "./mainAppLifecycle";
import { createOwnedShutdown } from "./ownedShutdown";
import { registerIpcHandlers } from "./ipc";
import { initSessionStore, getSession, getSidebarState, archiveSession, listSessions } from "./sessions";
import { buildAppMenu } from "./menu";
import { watchTheme } from "./theme";
import { logger } from "./logger";
import { hostShutdownGate } from "./shutdown";
import { createTerminalIpcService, registerTerminalIpc, type TerminalIpcService } from "./terminalIpc";
import { createDockTerminalIpcService, registerDockTerminalIpc, type DockTerminalIpcService } from "./dockTerminalIpc";
import { recoverPersistedTaskRuntimes, wireTaskRuntimeIpc, type TaskRuntimeIpcDeps } from "./taskRuntimeIpc";
import { currentTestOverrides } from "./testOverrides";
import { appDataRoot, initAppDataRoot } from "./appDataRoot";
import { cleanupElectronDebris, defaultDataRoot, migrateAppData, readDataRootPointer } from "./userDataRoot";
import { migrateLegacyTranscripts } from "./sessionFiles";
import { applyEarlyBootSettings } from "./earlyBoot";
import { installCustomCaVerify } from "./customCaVerify";
import { initTray, markTrayQuitting } from "./tray";
import { disposeKeepAwake } from "./powerBlocker";
import { startAutoArchive, type AutoArchiveService } from "./autoArchive";
import { broadcastSidebar } from "./sessionEvents";
import { resolveShellLaunch } from "@innocenceharness/terminal-pty";

// Test roots are opt-in through the centralized controlled marker. Packaged
// production ignores all test override variables unless the acceptance launcher
// also supplies the dedicated argument.
const testOverrides = currentTestOverrides(app.isPackaged);
if (testOverrides.userData) {
  // 验收/测试根：Electron 缓存与会话数据都隔离到测试根。
  app.setPath("userData", testOverrides.userData);
  initAppDataRoot(testOverrides.userData);
} else {
  // 应用数据根与会话真相源：所有应用产生的数据（会话、设置、日志、凭据、
  // 任务）都落在 ~/.innocence（用户改过存储位置时指针文件 data-root.json
  // 优先），会话转写进 sessions/ 日期树（自描述 JSONL，实时追加，索引可由
  // 扫描重建）。Electron 自身的 userData 不再重定向——Chromium 缓存/档案留
  // 在默认 Roaming/<name>，历史重定向残留在数据根里的 Electron 垃圾一次性
  // 清走。改名前的旧默认根（appData/InnocenceCode）与当前名根都作为迁移
  // 源：应用数据项整项搬（目标存在跳过），transcripts 旧布局按会话逐文件
  // 并入 sessions 树（见 sessionFiles），索引由启动扫描重建吸收。
  const legacyRoots = [app.getPath("userData")];
  const appDataDir = app.getPath("appData");
  const preRenameRoot = appDataDir ? `${appDataDir}${path.sep}InnocenceCode` : "";
  if (preRenameRoot && !legacyRoots.includes(preRenameRoot)) legacyRoots.push(preRenameRoot);
  const dataRoot = readDataRootPointer(path.join(defaultDataRoot(), "data-root.json")) ?? defaultDataRoot();
  const migrations: string[] = [];
  for (const legacy of legacyRoots) {
    migrations.push(...migrateAppData(legacy, dataRoot));
  }
  const transcriptMigration = migrateLegacyTranscripts(dataRoot, legacyRoots);
  migrations.push(
    ...transcriptMigration.moved.map((id) => `migrated transcript ${id} into sessions tree`),
    ...transcriptMigration.failed,
  );
  initAppDataRoot(dataRoot);
  const debris = cleanupElectronDebris(dataRoot);
  for (const outcome of [...migrations, ...debris]) logger.info(`data root migration: ${outcome}`);
}

// 早期启动设置（硬件加速/代理/自定义 CA 的子进程环境）必须在 app ready 前
// 施加；设置文件路径指向生效应用数据根。
applyEarlyBootSettings(path.join(appDataRoot(), "harness-settings.json"));

// Windows toast 通知需要稳定的 AppUserModelId（与打包元数据同一字符串），
// 否则系统通知静默丢弃。
if (process.platform === "win32") app.setAppUserModelId("InnocenceHarness");

// Custom schemes must be registered before app ready.
registerAppScheme();
registerPluginScheme();

/** Terminal IPC service — disposed on quit so no shell trees survive exit. */
let terminalService: TerminalIpcService | undefined;
let dockTerminalService: DockTerminalIpcService | undefined;
let taskRuntimeDeps: TaskRuntimeIpcDeps | undefined;
/** 自动归档巡检服务 — 关机时停表。 */
let autoArchiveService: AutoArchiveService | undefined;

const appLifecycle = createMainAppLifecycle({
  createMainWindow,
  getMainWindow,
  recover: () => {
    if (!taskRuntimeDeps) throw new Error("task runtime IPC not initialized");
    return recoverPersistedTaskRuntimes(taskRuntimeDeps);
  },
  startAutomation: startAutomationLifecycle,
  logRecoveryFailure: (error) => logger.error("task restart recovery failed", { error: String(error) }),
  logAutomationStartFailure: (error) => logger.error("automation lifecycle startup failed", { error: String(error) }),
});

/** Renderer push port shared by every task-runtime surface. */
const broadcast = (channel: string, payload: unknown): void => {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // 托盘的主窗口访问口（关闭到托盘启用后托盘菜单才能显示/聚焦窗口）。
  initTray({ getWindow: getMainWindow });
  app.on("second-instance", () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      // 隐藏到托盘后二次启动必须重新显示窗口。
      win.show();
      win.focus();
    }
  });

  void app.whenReady()
    .then(async () => {
      handleAppScheme();
      // Plugin asset scheme: same dual roots the plugin loader resolves
      // against (user root shadows the staging builtin root). The builtin
      // root reuses the composition's bootPaths so the packaged layout
      // (resources/plugins) is served instead of a cwd-relative dev path.
      handlePluginScheme({
        userRoot: testOverrides.userPluginRoot ?? defaultUserPluginRoot(),
        builtinRoot: testOverrides.builtinPluginRoot ?? bootPaths().builtinRoot,
      });
      initSessionStore(appDataRoot());
      registerIpcHandlers();
      await initHarness();

      // 自定义 CA：渲染层证书的兜底校验链（Chromium 默认结果有效时不受影
      // 响）；PEM 不可读/无有效证书时保留默认校验。
      const customCa = getHarnessSettings().customCaCert ?? "";
      if (customCa !== "" && !installCustomCaVerify(session.defaultSession, customCa)) {
        logger.warn("custom CA bundle unusable; default verify chain kept", { customCa });
      }

      // 常规设置的主进程副作用（关闭到托盘/阻止休眠）：启动时应用一次，
      // 之后每次设置提交在 harnessGlue 内幂等重放。
      applyHostSettingsSideEffects();

      // 自动归档巡检：启动立即一轮 + 周期巡检，每轮读当前设置。
      autoArchiveService = startAutoArchive({
        settings: () => getHarnessSettings(),
        listSessions: () => listSessions(),
        sidebarState: () => getSidebarState(),
        isRunning: isSessionRunning,
        archive: (id) => archiveSession(id, true),
        broadcast: broadcastSidebar,
        log: (level, msg, data) => logger[level](msg, data),
      });

      // Task runtime IPC composition (Task 12): task handlers over the real
      // bridge-backed command service, route-scoped code surfaces, and the
      // task-event broadcast feeding the renderer's workbench state.
      // task:start resolves the session's workspace root host-side and binds
      // the session's chat sends to the task route (the P1 loop entry).
      taskRuntimeDeps = {
        bridge: getTaskBridge(),
        taskStorageDir: getTaskStorageDir(),
        resolveRouteRoot: resolveRouteWorkspaceRoot,
        resolveSessionRoot: async (sessionId: string) => {
          const root =
            getSession(sessionId)?.workspaceRoot || getHarnessSettings().workspaceRoot;
          return root === "" ? undefined : root;
        },
        onSessionTaskRoute: bindSessionTaskRoute,
        getEditorCommand: () => getHarnessSettings().externalEditorCommand ?? "",
        onWorkbenchFocusNotice: handleWorkbenchFocusNotice,
        send: broadcast,
        log: (level: "info" | "warn" | "error", msg: string, data?: unknown) =>
          logger[level](msg, data),
      };
      await wireTaskRuntimeIpc(taskRuntimeDeps);

      // Route-bound terminals (Task 9): the service resolves each terminal's
      // cwd from the task bridge's route handle; output/exit events are
      // pushed to the main window through the standard broadcast pattern.
      // shell 按当前设置解析（terminalShell；仅新建终端生效）。
      const getShellLaunch = () => resolveShellLaunch(getHarnessSettings().terminalShell ?? "auto");
      terminalService = createTerminalIpcService({
        resolveRouteCwd: resolveRouteWorkspaceRoot,
        send: broadcast,
        getShellLaunch,
      });
      await registerTerminalIpc(terminalService);

      // dock 终端（右侧 dock 标签）：cwd 来自渲染端项目根，与任务路由终端隔离。
      dockTerminalService = createDockTerminalIpcService({ send: broadcast, getShellLaunch });
      await registerDockTerminalIpc(dockTerminalService);

      const win = await appLifecycle.createInitialWindow();
      // Non-mac: the custom title bar's File/Edit/View/Help buttons pop up
      // menus on demand (see src/main/menu.ts popupMenu), so no menu bar.
      Menu.setApplicationMenu(buildAppMenu(win));
      watchTheme(win);

      logger.info("app ready", { version: app.getVersion(), platform: process.platform });
    })
    .catch((err) => {
      logger.error("startup failed", { error: String(err) });
      app.quit();
    });

  // Keep running on macOS after all windows close.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Async shutdown, run exactly once: the harness owns OS resources (MCP
  // child processes, in-flight builds, pending permission asks) that must be
  // released before quit. Every quit attempt BEFORE the release completes is
  // preventDefault'ed — including re-entrant attempts arriving mid-release
  // (e.g. window-all-closed firing app.quit() again), which would otherwise
  // exit the process mid-disposeAllRuntime. Once the gate is released, the
  // final app.quit() goes through untouched. The gate is the process-wide
  // singleton (shutdown.ts): the harness glue reads its state when composing
  // sessions, so the hooks stop face skips during the quit path.
  const shutdown = hostShutdownGate;
  const shutdownWork = createOwnedShutdown({
    blockStartup: appLifecycle.startup.block,
    waitForStartup: () => appLifecycle.startup.completion,
    rejectPendingPermissionAsks,
    disposeAutomationLifecycle,
    disposeAllRuntime,
    disposeTelemetry,
    disposePluginBoot,
    disposeTaskRuntime,
    disposeTerminals: async () => {
      await terminalService?.disposeAll();
      await dockTerminalService?.disposeAll();
    },
  });
  app.on("before-quit", (e) => {
    // 退出流程置标：关闭到托盘的 close 拦截自此失效，托盘随退出销毁；巡
    // 检计时器与电源阻止器同步释放（幂等，quit 重入安全）。
    markTrayQuitting();
    autoArchiveService?.stop();
    disposeKeepAwake();
    const phase = shutdown.onBeforeQuit();
    if (phase === "release") return;
    e.preventDefault();
    if (phase === "hold") return; // release already running; just hold this quit
    void shutdownWork().catch((err) => {
      logger.error("shutdown dispose failed", { error: String(err) });
    }).finally(() => {
      shutdown.markReleased();
      app.quit();
    });
  });

  app.on("activate", () => {
    void appLifecycle.activate();
  });
}

// Crash reporting hook — placeholder for a real crash-reporter pipeline.
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { message: err.message, stack: err.stack });
});

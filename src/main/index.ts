// InnocenceHarness main entry: single-instance lock, protocol registration,
// then window.
import { app, Menu } from "electron";
import {
  handleAppScheme,
  handlePluginScheme,
  registerAppScheme,
  registerPluginScheme,
} from "./protocol";
import {
  bindSessionTaskRoute,
  bootPaths,
  getHarnessSettings,
  getTaskBridge,
  getTaskStorageDir,
  initHarness,
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
import { initSessionStore, getSession } from "./sessions";
import { buildAppMenu } from "./menu";
import { watchTheme } from "./theme";
import { logger } from "./logger";
import { hostShutdownGate } from "./shutdown";
import { createTerminalIpcService, registerTerminalIpc, type TerminalIpcService } from "./terminalIpc";
import { recoverPersistedTaskRuntimes, wireTaskRuntimeIpc, type TaskRuntimeIpcDeps } from "./taskRuntimeIpc";
import { currentTestOverrides } from "./testOverrides";

// Test roots are opt-in through the centralized controlled marker. Packaged
// production ignores all test override variables unless the acceptance launcher
// also supplies the dedicated argument.
const testOverrides = currentTestOverrides(app.isPackaged);
if (testOverrides.userData) app.setPath("userData", testOverrides.userData);

// Custom schemes must be registered before app ready.
registerAppScheme();
registerPluginScheme();

/** Terminal IPC service — disposed on quit so no shell trees survive exit. */
let terminalService: TerminalIpcService | undefined;
let taskRuntimeDeps: TaskRuntimeIpcDeps | undefined;

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
  app.on("second-instance", () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
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
      initSessionStore(app.getPath("userData"));
      registerIpcHandlers();
      await initHarness();

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
        send: broadcast,
        log: (level: "info" | "warn" | "error", msg: string, data?: unknown) =>
          logger[level](msg, data),
      };
      await wireTaskRuntimeIpc(taskRuntimeDeps);

      // Route-bound terminals (Task 9): the service resolves each terminal's
      // cwd from the task bridge's route handle; output/exit events are
      // pushed to the main window through the standard broadcast pattern.
      terminalService = createTerminalIpcService({
        resolveRouteCwd: resolveRouteWorkspaceRoot,
        send: broadcast,
      });
      await registerTerminalIpc(terminalService);

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
    },
  });
  app.on("before-quit", (e) => {
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

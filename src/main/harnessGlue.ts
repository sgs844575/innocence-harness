// Harness glue — owns settings persistence, the HarnessRuntime instance and
// the permission-ask registry. This module is the host composition root: it
// resolves each agent session's plugin set, kernel scope and spine suite
// through the session composition (pluginBoot/sessionComposition.ts — the
// staging kernel/spine boot, the dual-root resolver, builtin plugin loading
// and per-session assembly live there), so the active set comes from staging
// manifest.json descriptors + resolvePluginSet (local copy) over project
// .innocence/plugins.yml + user settings toggles. The runtime's UI-bridge
// hooks live in runtimeHooks.ts.
import { createAutomationService, type AutomationCandidate, type AutomationService } from "@innocenceharness/harness-automation";
import { createAutomationLifecycle, type AutomationLifecycle } from "./automationLifecycle";
import { createAutomationStore } from "./automationStore";
import { createAutomationRuntimeDispatch } from "./automationRuntimeAdapter";
import { createLazyNotifySink } from "./notifySink";
import { createAutomationCandidateService, createStructuredOutputPort } from "@innocenceharness/harness-ai-runtime";
import type { ProviderModel } from "@innocenceharness/harness-providers";
import { app, dialog, Notification, powerMonitor } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { openSecureStorage } from "@innocenceharness/secure-storage-node";
import {
  DEFAULT_ROUTE_ID,
  HarnessRuntime,
  DEFAULT_SETTINGS,
  createPermissionClassifier,
  listModels,
  mergeSettings,
  type HarnessSettings as PkgSettings,
} from "@innocenceharness/harness-electron";
import { IPC, type AgentModeInfo, type PermissionChoice, type PluginInventory } from "../shared/ipc";
import type { PluginBoot } from "./pluginBoot";
import { createSessionComposition } from "./pluginBoot";
import { isWorktreeSession } from "./taskWorktreePredicate";
import { buildProviderFromSettings } from "./pluginBoot/sessionComposition";
import { detectProjectTraits, type ProjectFacts } from "./pluginBoot/projectTraits";
import { createHostTelemetry } from "./telemetry";
import { createRuntimeHooks, cancelPendingAsks, type PendingPermissionRegistry } from "./runtimeHooks";
import { createSendToTeammate } from "./teammatePort";
import { sessionHasFinishedTurn, summarizeSessionUsage } from "./sessionUsage";
import * as sessions from "./sessions";
import { ensureSessionScratchDir } from "./sessionScratch";
import { appendSubagentHistoryEvent } from "./subagentHistoryStore";
import { appDataRoot } from "./appDataRoot";
import { getMainWindow } from "./appWindow";
import { broadcastTheme, setTheme } from "./theme";
import { logger } from "./logger";
import { hostShutdownGate } from "./shutdown";
import { broadcastSessions, broadcastSidebar } from "./sessionEvents";
import { createCredentialStore } from "./credentialStore";
import { createDesktopNotifier } from "./desktopNotify";
import { applyCloseToTray } from "./tray";
import { applyKeepAwake } from "./powerBlocker";
import { createBackgroundJobs, type BackgroundJobsFacade } from "./backgroundJobs";
import { getWorkbenchFocus, setWorkbenchFocus } from "./workbenchFocus";
import { diagnoseFocusedFile, diagnosticFingerprint } from "@innocenceharness/harness-diagnostics";

/** S4：渲染层工作台焦点上报入口（ipc.ts 的 code:focus-changed 消费）。 */
export function handleWorkbenchFocusNotice(notice: {
  taskId: string;
  relativePath: string;
  line?: number;
}): void {
  const binding = getTaskHandle(notice.taskId);
  if (!binding || typeof notice.relativePath !== "string" || !notice.relativePath.trim()) {
    return;
  }
  const workspaceRoot = getTaskBridge().get(notice.taskId)?.workspaceRoot;
  const current = getWorkbenchFocus();
  const notes = workspaceRoot ? diagnoseFocusedFile(workspaceRoot, notice.relativePath) : [];
  // Only newly seen fingerprints are forwarded; a repeated focus change does
  // not keep re-announcing the same compiler errors on every Read.
  const previous = current?.sessionId === binding.sessionId && current.file === notice.relativePath
    ? new Set((current.diagnostics ?? []).map(diagnosticFingerprint))
    : new Set<string>();
  const diagnostics = notes.filter((note) => !previous.has(diagnosticFingerprint(note)));
  setWorkbenchFocus({
    sessionId: binding.sessionId,
    file: notice.relativePath,
    ...(typeof notice.line === "number" && notice.line > 0 ? { line: notice.line } : {}),
    ...(diagnostics.length ? { diagnostics } : {}),
  });
}
import { hydrateCredentials, secureSettingsUpdate, setProfileCredential } from "./settingsCredentials";
import { toPersistedSettings, toSettingsMirror } from "./settingsMirror";
import { createSettingsMutationGate } from "./settingsMutationGate";
import { applySettingsPatch } from "./settingsPatchMutation";
import type { HarnessSettingsPatch } from "../shared/settingsPatch";
import { currentTestOverrides } from "./testOverrides";
import {
  createTaskRuntimeBridge,
  resolveTaskWorkspaceRoot,
  taskPluginsForRoute,
  type TaskRuntimeBridge,
} from "./taskRuntimeBridge";
import { reduceTask } from "@innocenceharness/task-core";

let settings: PkgSettings = DEFAULT_SETTINGS;
const settingsMutationGate = createSettingsMutationGate();
const pendingAsks: PendingPermissionRegistry = new Map();

function automationFile(): string {
  return path.join(appDataRoot(), "automations.json");
}

let automationService: AutomationService | undefined;
let automationLifecycle: AutomationLifecycle | undefined;

/** Loop 载荷解析：服务未建/查无定义/载荷无效都返回 undefined，回合回退非 loop 路径。 */
function automationLoopTargetOf(id: string): { name: string; loopFile: string } | undefined {
  const service = automationService ?? getAutomationService();
  const definition = service.list().find((item) => item.id === id);
  const loopFile = definition?.loop?.loopFile?.trim();
  if (!definition || !loopFile) return undefined;
  return { name: definition.name, loopFile };
}

function getAutomationService(): AutomationService {
  if (automationService) return automationService;
  const store = createAutomationStore(automationFile());
  automationService = createAutomationService({
    candidateService: createAutomationCandidateService(createStructuredOutputPort()),
    candidateModel: async (): Promise<ProviderModel> => {
      const provider = await buildProviderFromSettings(await ensureBoot(), settings);
      if (!("model" in provider)) throw new Error("configured provider does not expose a model");
      return provider.model;
    },
    store,
    timeoutMs: 60_000,
    dispatch: createAutomationRuntimeDispatch({
      runtime,
      sessionExists: (sessionId) => sessions.getSession(sessionId) !== undefined,
      taskRouteFor: (sessionId) => sessionTaskRoutes.get(sessionId),
      notify: createLazyNotifySink(),
      onNotifyError: (error) => logger.warn("automation notify failed", error),
      loop: {
        definitionFor: automationLoopTargetOf,
        // 全完成停用走 lifecycle.update（而非直接 updateDefinition），
        // 让步频 dispatcher 立即同步、移除注册并停掉定时器。宿主已停机
        // （lifecycle 已释放）时跳过：重建 lifecycle 会复活定时器；定义
        // 保持 enabled，重启后下一轮 [loop-complete] 会再次触发停用。
        disable: async (id) => {
          const lifecycle = automationLifecycle;
          if (!lifecycle) return;
          const definition = (automationService ?? getAutomationService()).list().find((item) => item.id === id);
          if (!definition) throw new Error("automation not found");
          await lifecycle.update(id, definition.candidate, definition.name, definition.targetSessionId, false);
        },
        onDisableError: (error) => logger.warn("automation loop disable failed", error),
      },
    }),
  });
  return automationService;
}

function getAutomationLifecycle(): AutomationLifecycle {
  if (automationLifecycle) return automationLifecycle;
  automationLifecycle = createAutomationLifecycle({
    controlledService: getAutomationService(),
    isIdle: (minimumIdleMs) => powerMonitor.getSystemIdleTime() * 1_000 >= minimumIdleMs,
    onActivity: (listener) => {
      powerMonitor.on("user-did-become-active", listener);
      return () => powerMonitor.removeListener("user-did-become-active", listener);
    },
    log: (message, data) => logger.warn(message, data),
  });
  return automationLifecycle;
}

// S1 后台作业（懒建）：会话走会话存储（blocked 后用户可选中继续对话），
// 暂存目录在 userData/background/<jobId>，通知复用 notify 汇，回复观察复用
// 4D 同一基础设施（增量镜像 + 错误旗标）。
let backgroundJobsFacade: BackgroundJobsFacade | undefined;
const backgroundNotifySink = createLazyNotifySink();
// A:58：后台作业会话登记（写隔离武装集）。会话 id 全局唯一，陈旧条目对新
// 会话惰性无害（id 不复用）；体积为字符串集，接受常驻。
const backgroundIsolatedSessions = new Set<string>();

/** 生产装配的后台作业面（IPC background:start 消费）。 */
export function getBackgroundJobs(): BackgroundJobsFacade {
  backgroundJobsFacade ??= createBackgroundJobs({
    runtime,
    createSession: (title, workspaceRoot) => {
      const session = sessions.createSession({ title, workspaceRoot });
      backgroundIsolatedSessions.add(session.id);
      broadcastSessions();
      broadcastSidebar();
      return session;
    },
    // 与 chat:send / sendChatTurn 同形的落账（含广播），令钩子更新与侧边
    // 排序对后台回合同样生效。
    appendUserMessage: (sessionId, text) => {
      sessions.appendMessage(sessionId, {
        id: messageId(),
        role: "user",
        parts: [{ type: "text", text }],
        createdAt: Date.now(),
      });
      broadcastSessions();
      broadcastSidebar();
    },
    appendAssistantPlaceholder: (sessionId, assistantMessageId) => {
      sessions.appendMessage(sessionId, {
        id: assistantMessageId,
        role: "assistant",
        parts: [],
        createdAt: Date.now(),
        streaming: true,
      });
      broadcastSessions();
    },
    scratchRoot: () => path.join(appDataRoot(), "background"),
    // 退出窗口不通知：关机中止的运行会被判失败，此时免打扰。
    notify: (message) =>
      hostShutdownGate.isShuttingDown()
        ? Promise.resolve()
        : backgroundNotifySink.send(message),
    onNotifyError: (error) => logger.warn("background job notify failed", error),
    log: (level, msg, data) => logger[level](msg, data),
  });
  return backgroundJobsFacade;
}

/** Restores valid confirmed automatic definitions after host session initialization. */
export function startAutomationLifecycle(): void {
  getAutomationLifecycle().start();
}

/** Releases automatic timers and awaits aborted controlled dispatch cleanup. */
export async function disposeAutomationLifecycle(): Promise<void> {
  const lifecycle = automationLifecycle;
  automationLifecycle = undefined;
  await lifecycle?.dispose();
}

export function generateAutomationCandidate(prompt: string): Promise<AutomationCandidate> {
  return getAutomationService().generateCandidate(prompt);
}

export function confirmAutomation(candidate: AutomationCandidate, name: string, targetSessionId?: string) {
  if (targetSessionId && !sessions.getSession(targetSessionId)) throw new Error("automation session not found");
  return getAutomationLifecycle().confirm(candidate, name, targetSessionId);
}

export function updateAutomation(
  id: string,
  candidate: AutomationCandidate,
  name: string,
  targetSessionId: string | undefined,
  enabled: boolean,
) {
  if (targetSessionId && !sessions.getSession(targetSessionId)) throw new Error("automation session not found");
  return getAutomationLifecycle().update(id, candidate, name, targetSessionId, enabled);
}

export function deleteAutomation(id: string): boolean {
  return getAutomationLifecycle().delete(id);
}

export function listAutomations() {
  return getAutomationService().list();
}

export function triggerAutomation(input: Parameters<AutomationService["trigger"]>[1] & { id: string }) {
  return getAutomationService().trigger(input.id, input);
}

function settingsFile(): string {
  return path.join(appDataRoot(), "harness-settings.json");
}

function credentialsDir(): string {
  return path.join(appDataRoot(), "provider-credentials");
}

async function credentialStore() {
  return createCredentialStore(await openSecureStorage(credentialsDir(), { dirs: ["keys"] }));
}

// ---------------------------------------------------------------------------
// Plugin boot（内核化装载）
// ---------------------------------------------------------------------------

/** dev：仓库 staging 树；prod：打包 resources 下的同一布局（forge
 *  extraResource 把 build/dist/resources/{plugins,node_modules} 复制到
 *  resources/）。内核与脊柱经动态 import 装载（单实例），src/main 不再静态
 *  import vendor/kernel 的运行时值。插件协议接线（innocenceharness-plugin:// 的
 * 内置根）复用同一双分支，消除打包态 cwd 相对路径的 404。 */
export function bootPaths(): { kernelPath: string; builtinRoot: string } {
  const builtinOverride = currentTestOverrides(app.isPackaged).builtinPluginRoot;
  if (app.isPackaged) {
    const resources = process.resourcesPath;
    return {
      kernelPath: path.join(resources, "node_modules", "@innocenceharness", "kernel", "dist", "index.js"),
      builtinRoot: builtinOverride ?? path.join(resources, "plugins"),
    };
  }
  const staging = path.resolve(process.cwd(), "build", "dist", "resources");
  return {
    kernelPath: path.join(staging, "node_modules", "@innocenceharness", "kernel", "dist", "index.js"),
    builtinRoot: builtinOverride ?? path.join(staging, "plugins"),
  };
}

/** Session composition: the boot singleton (retry-on-failure), builtin
 *  plugin loading and per-session plugin assembly live in pluginBoot/
 *  sessionComposition (Electron-free, Node-testable); this module injects
 *  the Electron-side path/workspace/log ports. The teammate port factory
 *  closes over runtime/getTaskBridge() below — it only ever runs at session
 *  build time, long after both are initialized. */
const sessionComposition = createSessionComposition({
  resolvePaths: bootPaths,
  getWorkspaceRoot: () => settings.workspaceRoot || undefined,
  getUserPluginRoot: () => currentTestOverrides(app.isPackaged).userPluginRoot ?? undefined,
  enableHmrWatcher: !app.isPackaged && process.env.NODE_ENV !== "production",
  createTeammatePort: (identity) =>
    createSendToTeammate(
      {
        runtime,
        listTeammateRoutes: async (taskId) => [
          ...reduceTask(await getTaskBridge().listEvents(taskId)).routes.keys(),
        ],
      },
      identity,
    ),
  onPluginClientChange: () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.pluginsChanged);
  },
  // reminders 工厂的会话状态端口（批次 4F）：两者都从会话存储现算（最小面
  // ——不另维护累计 Map）：runtimeHooks onCompleted 已把每轮 completion.usage
  // 写进消息，listMessages 惰性水合同一 transcript，读写同源。usage 逐轮求和
  // （每条助手消息的 usage 即该轮各步之和——loop 在发 done 前累加）；
  // continuation 以"已存在带 completion 的助手轮"判定（重建会话首轮恰为
  // transcript 种子的存储侧镜像）。
  getSessionUsage: (sessionId) => summarizeSessionUsage(sessions.listMessages(sessionId)),
  isContinuationSession: (sessionId) => sessionHasFinishedTurn(sessions.listMessages(sessionId)),
  // 宿主关机旗标（批次 5 修复 1）：before-quit 握手闸的查询面经组合根穿线
  // 到 hooks 工厂的 stop 面——关机态下 sessionStop 整面跳过，退出进程不再
  // 孵化钩子子进程（闸为 shutdown.ts 的进程级单例：组合根在 import 期构建，
  // 早于主入口注册 quit 处理器，getter 逐调用现读闸态）。
  isHostShuttingDown: () => hostShutdownGate.isShuttingDown(),
  log: (level, msg, data) => logger[level](msg, data),
});

function ensureBoot(): Promise<PluginBoot> {
  return sessionComposition.ensureBoot();
}

/** App shutdown: unwinds the boot root (cascades into live route scopes).
 *  Never rejects — failures surface through the harness log. */
export async function disposePluginBoot(): Promise<void> {
  await sessionComposition.disposePluginBoot();
}

/** Bridge + storage dir for the host's task-runtime IPC composition (Task 12).
 *  惰性求值：启动早期才注入应用数据根（~/.innocence），模块加载期取值会
 *  钉死未初始化的回落根。 */
let taskStorageDirCache: string | undefined;
let taskBridgeCache: TaskRuntimeBridge | undefined;

export function getTaskBridge(): TaskRuntimeBridge {
  taskBridgeCache ??= createTaskRuntimeBridge({
    taskStorageDir: getTaskStorageDir(),
    log: (level, msg, data) => logger[level]("task bridge", { msg, data: String(data) }),
  });
  return taskBridgeCache;
}

export function getTaskStorageDir(): string {
  taskStorageDirCache ??= path.join(appDataRoot(), "tasks");
  return taskStorageDirCache;
}

const telemetry = createHostTelemetry();

/** S2a：任务路由会话是否运行在宿主管理的工作树中（纯判定见
 *  taskWorktreePredicate——isolated 模式或有效根位于工作树存储目录下）。 */
function isTaskWorktreeSession(
  bridge: TaskRuntimeBridge,
  context: { taskId?: string; routeId: string },
): boolean {
  if (!context.taskId) return false;
  return isWorktreeSession(
    bridge.getRoute(context.taskId, context.routeId),
    path.join(getTaskStorageDir(), "worktrees"),
  );
}

/** A:95 工作树分叉会话：会话根位于 .innocence/worktrees/ 命名空间即视为
 *  隔离工作树会话（S2a 隔离纪律片段由此注入；父工作树因根切换天然禁入）。 */
function isForkWorktreeSession(sessionId: string): boolean {
  const root = sessions.getSession(sessionId)?.workspaceRoot ?? "";
  const normalized = root.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/.innocence/worktrees/");
}

/** 桌面通知器（taskNotifications 设置）：回合完成/失败与权限请求在主窗口
 *  未聚焦时发系统通知；点击通知显示并聚焦主窗口。设置惰性读取，live 跟随
 *  设置变更；关机静默（退出窗口不通知，与后台作业同一纪律）。 */
const desktopNotifier = createDesktopNotifier({
  settings: () => settings,
  windowFocused: () => {
    const win = getMainWindow();
    return Boolean(win && !win.isDestroyed() && win.isFocused() && win.isVisible() && !win.isMinimized());
  },
  sessionTitle: (sessionId) => sessions.getSession(sessionId)?.title,
  appName: () => app.getName(),
  send: ({ title, body, silent }) => {
    if (hostShutdownGate.isShuttingDown()) return;
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body, silent });
    notification.on("click", () => {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    notification.show();
  },
});

const runtime = new HarnessRuntime({
  settings: () => settings,
  // 会话转写落盘端口：宿主持有 sessions/ 日期树布局（id → 文件映射由
  // 会话外观解析），主/路由文件、实时快照与终稿行都走同一解析。
  transcriptFileFor: sessions.runtimeTranscriptFileFor,
  telemetry,
  // Route scopes: every session build mounts into a fresh kernel scope below
  // the plugin-boot root (dynamic staging kernel) — session dispose unwinds
  // the whole scope; the root and sibling routes stay untouched.
  sessionScope: async () => (await ensureBoot()).createSessionScope(),
  // Route spines: every session build mounts the SAME spine suite the boot
  // loaded from the staging tree (dynamic module identities shared with the
  // disk-loaded capability plugins; one spine per process).
  sessionSpine: async () => (await ensureBoot()).spine,
  // Authoritative per-route workspace root: a live task's effective workspace
  // (the isolated worktree) wins, then the session-bound project root, then
  // settings — settings.workspaceRoot is never the sole task root. The last
  // stop for project-less sessions is a per-session scratch dir under
  // ~/.innocence/tmp/<sessionId> (created on demand), so fs/shell tools never
  // anchor to the process install dir; unsafe ids keep the in-package
  // fallback (settings root || process.cwd()).
  workspaceRootFor: async (context) =>
    (context.taskId ? getTaskBridge().getRoute(context.taskId, context.routeId)?.workspaceRoot : undefined) ||
    resolveTaskWorkspaceRoot(context.sessionId, {
      getSessionWorkspaceRoot: (id) => sessions.getSession(id)?.workspaceRoot || undefined,
      fallbackRoot: settings.workspaceRoot,
    }) ||
    (await ensureSessionScratchDir(context.sessionId)),
  forkRoute: (input) => getTaskBridge().forkRoute(input),
  // S2a 工作树会话判定：与 workspaceRootFor 同一谓词（isolated 模式或有效
  // 根位于任务工作树存储目录下），供 buildSession 驱动子代理片段注册。
  isolatedWorktreeFor: (context) =>
    isTaskWorktreeSession(getTaskBridge(), {
      taskId: context.taskId || undefined,
      routeId: context.routeId,
    }) || isForkWorktreeSession(context.sessionId),
  // S3 权限分类器：设置开关开启时武装 ask 边界评估轮（副模型结构化判定，
  // 失败/超时/无意见回落用户询问）。模型走当次 settings 快照的活跃供应商，
  // 与 automation candidateModel 同一惰性解析路径；关闭时恒 undefined，
  // 权限行为与既有完全一致。
  permissionClassifierFor: (snapshot) =>
    snapshot.permissionClassifier
      ? createPermissionClassifier({
          model: async (): Promise<ProviderModel> => {
            const provider = await buildProviderFromSettings(await ensureBoot(), snapshot);
            if (!("model" in provider)) {
              throw new Error("configured provider does not expose a model");
            }
            return provider.model;
          },
          log: (level, msg, data) => logger[level](msg, data),
        })
      : undefined,
  // Project traits for the session's effective workspace: reads the root
  // package.json + directory listing + lockfiles, then derives the trait set
  // (pure detection lives in pluginBoot/projectTraits). Every read degrades
  // silently — a partially probed root yields partial facts, never a failed
  // session build.
  projectTraitsFor: async (workspaceRoot) => {
    const [pkgRaw, entries] = await Promise.all([
      // A non-object parse (array/primitive) degrades inside the detector:
      // every field is read optionally, so the cast needs no runtime guard.
      fs.readFile(path.join(workspaceRoot, "package.json"), "utf8")
        .then((text) => JSON.parse(text) as ProjectFacts["rootPackageJson"])
        .catch(() => undefined),
      fs.readdir(workspaceRoot, { withFileTypes: true })
        .then((dirents) => dirents.map((entry) => entry.name))
        .catch(() => [] as string[]),
    ]);
    const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"]
      .filter((file) => entries.includes(file));
    return detectProjectTraits({
      platform: {
        os: process.platform,
        shell: process.platform === "win32" ? "cmd" : "bash",
      },
      rootPackageJson: pkgRaw,
      lockfiles,
      topEntries: entries,
    });
  },
  pluginsForSession: async (context) => [
    // S2a 工作树会话判定：任务路由的有效根 ≠ 用户根 = 工作树会话（隔离主
    // 路由与分叉路由皆命中；baseline 主路由两根相等不命中）。
    ...(await sessionComposition.composePlugins(
      context.workspaceRoot,
      settings.pluginToggles,
      settings,
      // 会话身份（批次 4E）：team 工厂的队友端口绑定到当次构建的路由会话。
      {
        sessionId: context.sessionId,
        routeId: context.routeId,
        ...(context.taskId ? { taskId: context.taskId } : {}),
      },
      {
        isolatedWorktree: isTaskWorktreeSession(getTaskBridge(), context),
        workbenchFocus: () => getWorkbenchFocus(),
        backgroundIsolation:
          !context.taskId && backgroundIsolatedSessions.has(context.sessionId),
      },
    )),
    // Route-scoped task sessions get the change-capture middleware bound to
    // the live task's port; plain chat contexts contribute nothing.
    ...taskPluginsForRoute(getTaskBridge(), context),
  ],
  hooks: {
    ...createRuntimeHooks(pendingAsks, (kind, sessionId, options) =>
      desktopNotifier.notify(kind, sessionId, options),
    ),
    onSubagentLifecycle: (event) => {
      // 广播实况的同时落盘档案（delta 不落盘，见 subagentHistoryStore）——
      // 渲染层重启后按会话回放建档，历史运行才可再查看。档案 sidecar 与主
      // 转录同目录，路径经会话外观的文件映射解析。
      appendSubagentHistoryEvent(sessions.sessionSubagentHistoryFile(event.parentSessionId), event, Date.now());
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send(IPC.subagentLifecycle, event);
    },
  },
});

/** Loads persisted settings; call once at app start (idempotent). Runs
 *  before the window exists, so applying the theme needs no broadcast —
 *  the renderer pulls the resolved theme on load. */
export async function initHarness(): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(settingsFile(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      settings = DEFAULT_SETTINGS;
    } else {
      logger.error("settings load failed");
      settings = DEFAULT_SETTINGS;
    }
    setTheme(settings.themeMode ?? "system");
    logger.info("harness initialized", { activeProfile: settings.activeProfileId });
    return;
  }

  const merged = mergeSettings(raw);
  settings = merged;
  try {
    const hydrated = await hydrateCredentials(merged, await credentialStore());
    settings = hydrated.settings;
    for (const error of hydrated.errors) logger.error(error);
    if (hydrated.migrated && hydrated.errors.length === 0) {
      try {
        await fs.writeFile(settingsFile(), JSON.stringify(toPersistedSettings(settings), null, 2), "utf8");
      } catch (error) {
        const store = await credentialStore();
        await Promise.all(hydrated.createdRefs.map(async (ref) => {
          try { await store.delete(ref); } catch { /* best-effort rollback */ }
        }));
        settings = merged;
        throw error;
      }
      const store = await credentialStore();
      await Promise.all(hydrated.obsoleteRefs.map(async (ref) => {
        try { await store.delete(ref); } catch { /* stale cleanup is best effort */ }
      }));
    }
  } catch {
    // Keep the normalized settings and all non-credential data when migration
    // or its persistence fails. The next launch can retry migration safely.
    logger.error("credential migration failed");
  }
  setTheme(settings.themeMode ?? "system");
  logger.info("harness initialized", { activeProfile: settings.activeProfileId });
}

export function getHarnessSettings() {
  return toSettingsMirror(settings);
}

/** Serializes IPC reads behind pending mutations without recursively queuing from a mutation. */
export function getCommittedHarnessSettings() {
  return settingsMutationGate.read(() => toSettingsMirror(settings));
}

/** 插件清单投影（IPC plugins:list）：按当前 settings 现算——工作区取
 *  settings（空 = 无项目层），用户开关取 pluginToggles；每次调用重跑
 *  解析，设置写入后的重拉立即反映新状态。 */
export async function getPluginInventory(): Promise<PluginInventory> {
  await settingsMutationGate.waitForPending();
  return sessionComposition.pluginInventory({
    workspaceRoot: settings.workspaceRoot || undefined,
    userToggles: settings.pluginToggles,
  });
}

/** Agent 模式目录（IPC agents:modes）：staging manifest + 用户根扫描现算
 *  投影（去重合并、恒含 default 兜底）——与 getPluginInventory 同构，经
 *  sessionComposition 面现算，不缓存。 */
export function getAgentModes(): Promise<AgentModeInfo[]> {
  return sessionComposition.agentModes();
}

export function setHarnessSettings(next: HarnessSettingsPatch) {
  return settingsMutationGate.enqueue(async () => {
    const previous = settings;
    const candidate = applySettingsPatch(settings, next);
    const committed = await secureSettingsUpdate(previous, candidate, await credentialStore(), async (durable) => {
      await fs.writeFile(settingsFile(), JSON.stringify(toPersistedSettings(durable), null, 2), "utf8");
    });
    settings = committed;
    const prevTheme = previous.themeMode ?? "system";
    const nextTheme = settings.themeMode ?? "system";
    if (nextTheme !== prevTheme) {
      setTheme(nextTheme);
      const win = getMainWindow();
      if (win && !win.isDestroyed()) broadcastTheme(win);
    }
    // 常规设置的主进程副作用（托盘/电源阻止）：无条件幂等应用。
    applyHostSettingsSideEffects();
    return toSettingsMirror(settings);
  });
}

/** 常规设置的主进程副作用：关闭到托盘（仅 Windows 建托盘）与阻止系统休
 *  眠。幂等——启动后（initHarness 之后）与每次设置提交后各应用一次。 */
export function applyHostSettingsSideEffects(): void {
  applyCloseToTray(settings.closeToTray === true);
  applyKeepAwake(settings.keepAwake === true);
}

/** 会话是否有存活回合（主路由 + 任务绑定路由；自动归档的排除条件）。 */
export function isSessionRunning(sessionId: string): boolean {
  if (runtime.isRouteRunning(sessionId)) return true;
  const binding = sessionTaskRoutes.get(sessionId);
  return binding !== undefined && runtime.isRouteRunning(sessionId, binding.routeId);
}

/** Stores a key in secure host storage and returns the redacted settings projection. */
export function updateProviderApiKey(profileId: string, apiKey: string) {
  return settingsMutationGate.enqueue(async () => {
    const committed = await setProfileCredential(settings, profileId, apiKey, await credentialStore(), async (durable) => {
      await fs.writeFile(settingsFile(), JSON.stringify(toPersistedSettings(durable), null, 2), "utf8");
    });
    settings = committed;
    return toSettingsMirror(settings);
  });
}

/** Fetches a platform's model list (runs in main, where network is available). */
export async function listProviderModels(
  profile: Pick<PkgSettings["profiles"][number], "kind" | "apiKey" | "baseURL">,
): Promise<string[]> {
  return listModels(profile);
}

/** Fetches a configured profile's models without exposing its credential over IPC. */
export async function listProviderModelsById(profileId: string): Promise<string[]> {
  await settingsMutationGate.waitForPending();
  const profile = settings.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error("profile not found");
  return listProviderModels(profile);
}

export async function pickWorkspace(): Promise<string> {
  const win = getMainWindow();
  if (!win) return "";
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled || result.filePaths.length === 0 ? "" : result.filePaths[0];
}

export async function respondPermission(requestId: string, choice: PermissionChoice): Promise<void> {
  const pending = pendingAsks.get(requestId);
  // 未知 id = 请求已了结（超时兜底 deny、stop/dispose 取消、重复点击的第二次
  // 应答）。迟到/重复的 UI 应答不能改变 loop 已拿到的决定，按幂等空操作处理，
  // 只留 warn 轨迹，避免 IPC handler 抛出主进程级错误。
  if (!pending) {
    logger.warn("permission response for settled request ignored", { requestId });
    return;
  }
  pending.finish(choice);
}

let nextMsg = 0;
const messageId = () => `msg_${Date.now().toString(36)}_${(nextMsg++).toString(36)}`;

/**
 * Session -> task-route binding (task:start / switchRoute / restart recovery
 * keep it current): a bound session's chat sends run task-scoped, so tool
 * effects are captured, checkpointed and reviewable — the P1 loop.
 */
const sessionTaskRoutes = new Map<string, { taskId: string; routeId: string }>();

/** Host-side binding port the task command service calls on task activation. */
export function bindSessionTaskRoute(sessionId: string, taskId: string, routeId: string): void {
  sessionTaskRoutes.set(sessionId, { taskId, routeId });
}

/** S4：按任务查句柄（taskId → sessionId 绑定，供工作台焦点上报解析会话）。 */
export function getTaskHandle(taskId: string): { sessionId: string } | undefined {
  const handle = getTaskBridge().get(taskId);
  return handle ? { sessionId: handle.sessionId } : undefined;
}

/** Starts an agent turn; returns the assistant message id immediately. Plain
 * chat turns run on the main route without task identity; a session with a
 * live task binding sends on the task's active route. */
export function sendChatTurn(sessionId: string, text: string): string {
  const id = messageId();
  sessions.appendMessage(sessionId, {
    id,
    role: "assistant",
    parts: [],
    createdAt: Date.now(),
    streaming: true,
  });
  broadcastSessions();
  const binding = sessionTaskRoutes.get(sessionId);
  void runtime.send({
    sessionId,
    taskId: binding?.taskId ?? "",
    routeId: binding?.routeId ?? DEFAULT_ROUTE_ID,
    text,
    messageId: id,
  });
  return id;
}

export function stopChatTurn(sessionId: string): void {
  cancelPendingAsks(pendingAsks, sessionId);
  runtime.stop(sessionId);
}

/** 取消一个存活子代理运行（childId = lifecycle 事件 id = 运行注册表 id）；
 *  是否命中存活注册表项由 runtime 按会话各路由逐个尝试得出。 */
export function cancelSubagentRun(sessionId: string, childId: string): boolean {
  return runtime.cancelSubagent(sessionId, childId);
}

/**
 * Edit-and-resend (replace semantics): truncates the edited message and
 * everything after it (store + rewritten transcript), rewinds the route's
 * in-memory history, then starts a fresh turn with the edited text. Guards:
 * a running route and a task-bound session both refuse — a live turn would
 * race the rewind, and the task layer's checkpoints cannot be rewound with
 * the text layer. `newMessageId` is the renderer's optimistic bubble id,
 * adopted for the persisted user message so a later resend can find it.
 * Returns the new assistant message id.
 */
export function resendChatTurn(sessionId: string, fromMessageId: string, text: string, newMessageId?: string): string {
  if (runtime.isRouteRunning(sessionId)) throw new Error("session is streaming");
  if (sessionTaskRoutes.has(sessionId)) throw new Error("task-bound session cannot rewind");
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty message");
  const rewind = sessions.truncateMessagesFrom(sessionId, fromMessageId);
  if (!rewind) throw new Error("message not found");
  runtime.rewindHistory(sessionId, rewind.keptUserTurns);
  sessions.appendMessage(sessionId, {
    id: sessions.adoptMessageId(sessionId, newMessageId),
    role: "user",
    parts: [{ type: "text", text: trimmed }],
    createdAt: Date.now(),
  });
  return sendChatTurn(sessionId, trimmed);
}

/** Releases one chat session's agent resources (aborts runs, disposes its
 * plugins). Never rejects — failures surface through the harness log. */
export async function disposeSession(sessionId: string): Promise<void> {
  cancelPendingAsks(pendingAsks, sessionId);
  sessionTaskRoutes.delete(sessionId);
  await runtime.dispose(sessionId);
}


/** Rejects every unanswered permission ask (app shutdown): pending turns
 *  must not block on dialogs that will never be answered. */
export function rejectPendingPermissionAsks(): void {
  for (const pending of pendingAsks.values()) pending.finish("deny");
  pendingAsks.clear();
}

/** Releases every agent session's resources (app shutdown): aborts active
 *  runs, disposes all plugins (MCP child trees included). Never rejects. */
export async function disposeAllRuntime(): Promise<void> {
  await runtime.disposeAll();
}

/** Flushes and releases the host-owned tracing processors during app shutdown. */
export async function disposeTelemetry(): Promise<void> {
  await telemetry.dispose();
}

/** Releases every live task's runtime resources (app shutdown): watchers and
 *  worktree lease records. Worktrees survive restarts; explicit task
 *  deletion (destroyWorktree) runs only through the task flows. */
export async function disposeTaskRuntime(): Promise<void> {
  await getTaskBridge().disposeAll();
}

/** Route-bound terminals / code surfaces (Task 9/11): the authoritative
 *  per-route workspace root — the live handle first, then the persisted task
 *  state (restart recovery skips snapshot tasks, but their code panel and
 *  terminals still resolve). Renderer requests carry ids only, never paths. */
export async function resolveRouteWorkspaceRoot(
  taskId: string,
  routeId: string,
): Promise<string | undefined> {
  return getTaskBridge().durableRouteRoot(taskId, routeId);
}

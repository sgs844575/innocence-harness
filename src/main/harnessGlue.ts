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
import { app, dialog, powerMonitor } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { openSecureStorage } from "@innocenceharness/secure-storage-node";
import {
  DEFAULT_ROUTE_ID,
  HarnessRuntime,
  DEFAULT_SETTINGS,
  listModels,
  mergeSettings,
  type HarnessSettings as PkgSettings,
} from "@innocenceharness/harness-electron";
import { IPC, type AgentModeInfo, type PermissionChoice, type PluginInventory } from "../shared/ipc";
import type { PluginBoot } from "./pluginBoot";
import { createSessionComposition } from "./pluginBoot";
import { buildProviderFromSettings } from "./pluginBoot/sessionComposition";
import { detectProjectTraits, type ProjectFacts } from "./pluginBoot/projectTraits";
import { createHostTelemetry } from "./telemetry";
import { createRuntimeHooks, cancelPendingAsks, type PendingPermissionRegistry } from "./runtimeHooks";
import { createSendToTeammate } from "./teammatePort";
import * as sessions from "./sessions";
import { getMainWindow } from "./appWindow";
import { broadcastTheme, setTheme } from "./theme";
import { logger } from "./logger";
import { broadcastSessions } from "./sessionEvents";
import { createCredentialStore } from "./credentialStore";
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
  return path.join(app.getPath("userData"), "automations.json");
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
  return path.join(app.getPath("userData"), "harness-settings.json");
}

function credentialsDir(): string {
  return path.join(app.getPath("userData"), "provider-credentials");
}

async function credentialStore() {
  return createCredentialStore(await openSecureStorage(credentialsDir(), { dirs: ["keys"] }));
}

function transcriptsDir(): string {
  return path.join(app.getPath("userData"), "transcripts");
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
 *  closes over runtime/taskBridge below — it only ever runs at session
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
          ...reduceTask(await taskBridge.listEvents(taskId)).routes.keys(),
        ],
      },
      identity,
    ),
  onPluginClientChange: () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.pluginsChanged);
  },
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

/** Task runtime bridge: opens tasks (baseline/isolated), holds each task's
 *  TaskRuntimePort and injects plugin-task middleware into route-scoped
 *  sessions (see taskRuntimeBridge.ts — electron-free by construction). */
const taskStorageDir = path.join(app.getPath("userData"), "tasks");
const taskBridge = createTaskRuntimeBridge({
  taskStorageDir,
  log: (level, msg, data) => logger[level]("task bridge", { msg, data: String(data) }),
});
const telemetry = createHostTelemetry();

/** Bridge + storage dir for the host's task-runtime IPC composition (Task 12). */
export function getTaskBridge(): TaskRuntimeBridge {
  return taskBridge;
}

export function getTaskStorageDir(): string {
  return taskStorageDir;
}

const runtime = new HarnessRuntime({
  settings: () => settings,
  persistDir: transcriptsDir(),
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
  // settings — settings.workspaceRoot is never the sole task root.
  workspaceRootFor: (context) =>
    (context.taskId ? taskBridge.getRoute(context.taskId, context.routeId)?.workspaceRoot : undefined) ||
    resolveTaskWorkspaceRoot(context.sessionId, {
      getSessionWorkspaceRoot: (id) => sessions.getSession(id)?.workspaceRoot || undefined,
      fallbackRoot: settings.workspaceRoot,
    }),
  forkRoute: (input) => taskBridge.forkRoute(input),
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
    )),
    // Route-scoped task sessions get the change-capture middleware bound to
    // the live task's port; plain chat contexts contribute nothing.
    ...taskPluginsForRoute(taskBridge, context),
  ],
  hooks: {
    ...createRuntimeHooks(pendingAsks),
    onSubagentLifecycle: (event) => {
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
    return toSettingsMirror(settings);
  });
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
  if (!pending) throw new Error("permission request not found");
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
  await taskBridge.disposeAll();
}

/** Route-bound terminals (Task 9): the authoritative per-route workspace
 *  root for live tasks. The terminal IPC resolves cwd exclusively through
 *  this — renderer requests carry ids only, never paths. */
export function resolveRouteWorkspaceRoot(taskId: string, routeId: string): string | undefined {
  return taskBridge.getRoute(taskId, routeId)?.workspaceRoot;
}

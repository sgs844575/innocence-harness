// Session composition (split out of harnessGlue, Electron-free and
// Node-testable): owns the plugin-boot singleton (with retry-on-failure
// semantics), the builtin capability plugin loading/instantiation, the
// project permission-rules plugin and the settings-based provider assembly
// that every route session's plugin set is built from.
import path from "node:path";
import os from "node:os";
import {
  loadInnocenceConfig,
  rulesFromConfig,
  type InnocenceConfig,
  type ProjectPermissionConfig,
} from "@innocenceharness/harness-permissions";
import { createProviderPlugin } from "@innocenceharness/harness-providers";
import { createMockProvider } from "@innocenceharness/provider-mock";
import type { UsageMetadata } from "@innocenceharness/harness-providers";
import { WORKTREE_ISOLATION_FRAGMENT } from "@innocenceharness/harness-electron";
import type { FsPluginConfig } from "@innocenceharness/tools-fs";
import type { ShellPluginConfig } from "@innocenceharness/tools-shell";
import { resolveCommandShell } from "@innocenceharness/terminal-pty";
import {
  unavailableTeammatePort,
  type SendToTeammatePort,
} from "@innocenceharness/plugin-team";
import {
  unavailableAskUserPort,
  type AskUserPort,
} from "@innocenceharness/plugin-ask";
import {
  DEFAULT_SETTINGS,
  DEFAULT_ROUTE_ID,
  MOCK_GREETING,
  resolveActive,
  type HarnessPlugin,
  type HarnessSettings,
  type SessionPlugin,
  type SessionLoaderPlugin,
} from "@innocenceharness/harness-electron";
import type { Provider } from "@innocenceharness/harness-providers";
import type { Context, ObjectPlugin } from "@innocenceharness/kernel";
import { createWorktreeFencePlugin } from "@innocenceharness/tools-worktree";
import {
  createPluginBoot,
  defaultUserPluginRoot,
  readManifest,
  type PluginBoot,
} from "./compose";
import { scanUserPlugins, nativeProbe, claudeCodeProbe, type UserPluginScanResult } from "./userPluginScan";
import { createEcosystemAdapterPlugin } from "./ecosystemAdapter";
import type { HostHmrWatcher } from "./hmrWatcher";
import type {
  PluginDescriptor,
  PluginToggleSource,
} from "../plugin-toggles-local";
import type { PluginInventoryEntry } from "../plugin-inventory";
import type { AgentModeInfo } from "../../shared/ipc";

/** Inputs of {@link createSessionComposition}. */
export interface SessionCompositionOptions {
  /** Dev/prod staging paths, resolved per boot attempt (Electron-side duty). */
  resolvePaths(): { kernelPath: string; builtinRoot: string };
  /** Default workspace root recorded on the boot root (diagnostics anchor). */
  getWorkspaceRoot(): string | undefined;
  /** Severity sink for skipped-plugin notices, resolver warnings and boot
   * disposal failures (the host logger). */
  log(level: "info" | "warn" | "error", msg: string, data?: unknown): void;
  /** Optional registered group-name policy; absent means user-declared names are allowed. */
  getAllowedGroupNames?: () => readonly string[] | undefined;
  /** User plugin root resolved by the host for this boot attempt. */
  getUserPluginRoot?: () => string | undefined;
  /** Development-only watcher factory owned by the host composition. */
  createHmrWatcher?: () => HostHmrWatcher;
  /** Enable host file watching for development boot. */
  enableHmrWatcher?: boolean;
  /** Called after a watched plugin client changes. */
  onPluginClientChange?: (id: string) => void;
  /**
   * Teammate delivery port factory (batch 4E): binds one sendToTeammate port
   * to the identity of the route session being composed. Absent — or a
   * composition without session identity — still mounts the team plugin, and
   * every send_message call answers the no-teammates error.
   */
  createTeammatePort?: (identity: ComposeSessionIdentity) => SendToTeammatePort;
  /**
   * Ask-user port factory (ask_user 工具): binds one ask port to the identity
   * of the route session being composed. Absent — or a composition without
   * session identity — still mounts the ask plugin, and every ask_user call
   * answers the no-question-surface error.
   */
  createAskUserPort?: (identity: ComposeSessionIdentity) => AskUserPort;
  /**
   * Reads one session's cumulative token usage from the host session store
   * (batch 4F): feeds the reminders factory's usage-level getter. Absent
   * means the composition has no usage source and the reminder stays
   * unarmed.
   */
  getSessionUsage?: (sessionId: string) => UsageMetadata | undefined;
  /**
   * Reports whether a session continues from previously stored history
   * (batch 4F): feeds the reminders factory's continuation getter. The
   * composition binds it to main-route sessions only (the runtime seeds
   * transcripts on the main route).
   */
  isContinuationSession?: (sessionId: string) => boolean;
  /**
   * Reports whether the host process is on its quit path (batch 5 fix 1):
   * feeds the hooks factory's stop-face bypass getter. Absent means the
   * composing host has no shutdown handshake and the sessionStop face
   * always runs at session unwind.
   */
  isHostShuttingDown?: () => boolean;
}

/** Identity of the route session a composePlugins call assembles for. */
export interface ComposeSessionIdentity {
  sessionId: string;
  /** Normalized route id ("main" for plain chat turns). */
  routeId: string;
  /** Task the route belongs to; absent for plain chat (no teammates). */
  taskId?: string;
}

/** The composition face the host glue consumes. */
export interface SessionComposition {
  /** The boot singleton; a FAILED boot is not memoized (next call retries). */
  ensureBoot(): Promise<PluginBoot>;
  /** Unwind the boot root (app shutdown; cascades into live route scopes). */
  disposePluginBoot(): Promise<void>;
  /**
   * Manifest projection for the settings inventory: boot descriptor metadata
   * (boot-time snapshot) + a fresh builtin-set resolution per call, so the
   * current toggles decide the state. Empty workspaceRoot = no project layer.
   */
  pluginInventory(input: {
    workspaceRoot?: string;
    userToggles?: PluginToggleSource;
  }): Promise<PluginInventoryEntry[]>;
  /** One workspace's session plugin set (staging manifest + toggles + disk).
   *  The optional session identity (supplied by hosts whose runtime builds
   *  route sessions) is what the team factory binds its teammate port to. */
  composePlugins(
    workspaceRoot: string,
    userToggles?: PluginToggleSource,
    settings?: HarnessSettings,
    sessionIdentity?: ComposeSessionIdentity,
    sessionSurface?: {
      isolatedWorktree?: boolean;
      workbenchFocus?: () => WorkbenchFocusInput | undefined;
      /** A:58：武装会话（后台作业）的写隔离面（EnterWorktree + 围栏）。 */
      backgroundIsolation?: boolean;
    },
  ): Promise<SessionPlugin[]>;
  /**
   * Agent 模式目录（IPC agents:modes）：staging manifest（readManifest，
   * 含 kind 透传）+ 用户根扫描现算 → projectAgentModes 投影（去重合并、
   * 恒含 default 兜底）。每次调用现算，不缓存。
   */
  agentModes(): Promise<AgentModeInfo[]>;
}

/** Project permission rules (.innocence/config.json) as a plugin, so the
 *  runtime never loads project config itself — the composition owns it. */
function projectRulesPlugin(config: ProjectPermissionConfig | undefined): HarnessPlugin {
  return {
    name: "project-permission-rules",
    activate(ctx) {
      if (!config) return;
      for (const rule of rulesFromConfig(config)) ctx.registerPolicyRule(rule);
    },
  };
}

/**
 * 工作树会话隔离纪律片段（S2a）：内容常量在 harness-electron（组合根与
 * 子代理工厂两面共用一个来源）。仅对工作树会话注册（共享桶，全模式生效）。
 */
export function worktreeIsolationPlugin(active: boolean): ObjectPlugin {
  return {
    name: "worktree-isolation-notes",
    apply(ctx: Context) {
      if (!active) return;
      ctx.systemPrompt.registerFragment(WORKTREE_ISOLATION_FRAGMENT);
    },
  };
}

/** S4 工作台焦点（IDE 双件内部适配）：面板当前查看文件 + 可选焦点行。 */
export interface WorkbenchFocusInput {
  sessionId: string;
  file: string;
  line?: number;
  diagnostics?: readonly { code: number; line: number; column: number; message: string }[];
}

function normalizeForFocusMatch(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/**
 * 工作台焦点注记插件：Read 命中"当前会话正在面板中查看的文件"时，结果
 * 尾部附事实注记（文件已打开 + 可选焦点行）——用户注意力所在这条信号对
 * 代理有价值（源件 file-opened-in-ide / lines-selected-in-ide 语义的
 * 面板适配）。匹配按正斜杠归一的后缀比较（Read 的 path 可能是绝对路径）。
 */
export function workbenchFocusPlugin(
  getFocus: () => WorkbenchFocusInput | undefined,
): ObjectPlugin {
  return {
    name: "workbench-focus-notes",
    apply(ctx: Context) {
      ctx.tools.registerMiddleware({
        name: "workbench-focus",
        async execute(invocation, next) {
          const result = await next();
          if (invocation.toolName !== "Read" || result.isError) return result;
          const focus = getFocus();
          if (!focus || invocation.scope.sessionId !== focus.sessionId) return result;
          const readPath = normalizeForFocusMatch(
            String(invocation.args.path ?? ""),
          );
          const focusFile = normalizeForFocusMatch(focus.file);
          if (!readPath || !focusFile) return result;
          const hit =
            readPath === focusFile ||
            readPath.endsWith("/" + focusFile) ||
            readPath.endsWith(focusFile);
          if (!hit) return result;
          const line = typeof focus.line === "number" && focus.line > 0
            ? `（当前焦点行：第 ${focus.line} 行）`
            : "";
          const diagnostic = focus.diagnostics?.length
            ? `\n[新诊断注记：${focus.diagnostics.slice(0, 3).map((d) => `TS${d.code} 第 ${d.line}:${d.column} 行：${d.message}`).join("；")}]`
            : "";
          return {
            ...result,
            content: `${result.content}\n[工作台焦点注记：用户当前已在工作台代码面板打开此文件${line}]${diagnostic}`,
          };
        },
      });
    },
  };
}

/** Provider instance created from a staged opaque model. */
type ModelBackedProvider = Provider & { readonly model: import("@innocenceharness/harness-providers").ProviderModel };

type ModelFactoryConfig = {
  apiFormat?: import("@innocenceharness/harness-providers").ApiFormat;
  id?: string;
  apiKey?: string;
  baseURL?: string;
  model: string;
  reasoningEffort?: string;
};

type StagedModelFactory = (config: ModelFactoryConfig) => import("@innocenceharness/harness-providers").ProviderModel;

export type NativeProviderProfile = {
  apiFormat?: import("@innocenceharness/harness-providers").ApiFormat;
  id: string;
  kind: "openai" | "anthropic" | "google";
  apiKey: string;
  baseURL: string;
  model: string;
};

function asStagedModelFactory(value: unknown, id: string): StagedModelFactory {
  if (typeof value !== "function") {
    throw new Error(`provider factory "${id}" did not export a callable model factory`);
  }
  return value as StagedModelFactory;
}

function modelBackedProvider(model: import("@innocenceharness/harness-providers").ProviderModel): ModelBackedProvider {
  return {
    id: model.providerId,
    model,
    async *chat() {
      // The later runtime-loop task is the only owner of model execution.
      throw new Error("Model execution is unavailable");
    },
  };
}

/** Resolves one staged native profile to a fail-closed model carrier provider. */
export async function resolveStagedProvider(
  boot: Pick<PluginBoot, "importPlugin">,
  profile: NativeProviderProfile,
  reasoningEffort?: string,
): Promise<ModelBackedProvider> {
  const factoryId: Record<NativeProviderProfile["kind"], string> = {
    openai: "provider-openai",
    anthropic: "provider-anthropic",
    google: "provider-google",
  };
  const id = factoryId[profile.kind];
  const factory = asStagedModelFactory(await boot.importPlugin(id), id);
  return modelBackedProvider(factory({
    id: profile.id,
    apiKey: profile.apiKey || undefined,
    baseURL: profile.baseURL || undefined,
    model: profile.model,
    ...(profile.apiFormat ? { apiFormat: profile.apiFormat } : {}),
    reasoningEffort,
  }));
}

/**
 * Resolves current settings through the boot's dual-root staged resolver.
 * Legacy compatible profiles retain kind "openai" and therefore continue through
 * the compatible factory. The later runtime-loop task owns execution;
 * the carrier provider fails closed until then.
 */
export async function buildProviderFromSettings(
  boot: Pick<PluginBoot, "importPlugin">,
  settings: HarnessSettings,
): Promise<ModelBackedProvider | Provider> {
  const active = resolveActive(settings);
  if (active.kind === "mock") {
    return createMockProvider({ id: "mock", turns: [], exhaustedText: MOCK_GREETING });
  }
  const profile = settings.profiles.find((candidate) => candidate.id === settings.activeProfileId);
  if (!profile) {
    return createMockProvider({ id: "mock", turns: [], exhaustedText: MOCK_GREETING });
  }
  return resolveStagedProvider(boot, {
    id: profile.id,
    kind: active.kind,
    ...(profile.apiFormat ? { apiFormat: profile.apiFormat } : {}),
    apiKey: active.apiKey,
    baseURL: active.baseURL,
    model: active.model,
  }, settings.reasoningEffort || undefined);
}

/** Resolve a host-only factory lazily at the loader entry boundary. */
function factoryPlugin(
  boot: PluginBoot,
  id: "skills" | "mcp" | "creation" | "reminders" | "memory" | "hooks" | "team" | "ask" | "fs" | "shell",
  options: () =>
    | { dirs: string[] }
    | { servers: Record<string, unknown> }
    | { userRoot: string }
    | {
        getPermissionMode: () => string;
        getSessionUsage?: () => UsageMetadata | undefined;
        isContinuationSession?: () => boolean;
      }
    | { getUserRoot: () => string; getProjectRoot: () => string }
    | {
        getHooksConfig: () => Promise<unknown>;
        getWorkspaceRoot: () => string;
        isHostShuttingDown?: () => boolean;
      }
    | { sendToTeammate: SendToTeammatePort }
    | { askUser: AskUserPort }
    | FsPluginConfig
    | ShellPluginConfig,
): ObjectPlugin {
    return {
    name: `factory:${id}`,
    async apply(ctx) {
      const factory = await boot.importPlugin(id);
      const input = options();
      const create = factory as (value: typeof input) => ObjectPlugin | Promise<ObjectPlugin>;
      const plugin = await create(input);
      if (!plugin || typeof plugin.apply !== "function") {
        throw new Error(`builtin plugin "${id}" factory did not return a native plugin`);
      }
      return plugin.apply(ctx);
    },
  };
}

function factoryConfig(
  id: "skills" | "mcp",
  config: unknown,
  workspaceRoot: string,
  project: InnocenceConfig,
): { dirs: string[] } | { servers: Record<string, unknown> } {
  if (id === "skills") {
    const configured = config as { dirs?: unknown } | undefined;
    if (config !== undefined && (!configured || !Array.isArray(configured.dirs) || !configured.dirs.every((v) => typeof v === "string"))) {
      throw new Error("invalid skills group config: dirs must be a string array");
    }
    return { dirs: configured?.dirs as string[] ?? [path.join(workspaceRoot, ".innocence", "skills"), path.join(os.homedir(), ".innocence", "skills")] };
  }
  const configured = config as { servers?: unknown } | undefined;
  if (config !== undefined && (!configured || !configured.servers || typeof configured.servers !== "object" || Array.isArray(configured.servers))) {
    throw new Error("invalid mcp group config: servers must be an object");
  }
  return { servers: configured?.servers as Record<string, unknown> ?? (project.mcpServers ?? {}) as Record<string, unknown> };
}

function validGroupSegment(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/[\\/:]/.test(value);
}

type ResolvedGroupChild = {
  id: string;
  name: string;
  config?: unknown;
  disabled?: boolean;
  plugin?: ObjectPlugin;
};

function groupChildOptions(
  entry: import("@innocenceharness/kernel-loader").EntryOptions,
): ResolvedGroupChild {
  return { ...entry, name: entry.name ?? entry.id };
}

function groupConfigOf(id: string, config: unknown): { id: string; entries: readonly unknown[] } {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`loader group entry "${id}" has invalid config`);
  }
  const value = config as { id?: unknown; entries?: unknown };
  if (!validGroupSegment(value.id) || !Array.isArray(value.entries)) {
    throw new Error(`loader group entry "${id}" has invalid config`);
  }
  return { id: value.id, entries: value.entries };
}

// Factory-only builtins: their staged default export is a factory that needs
// host-assembled configuration (top-level builtinLoaderEntryFor wiring). A yml
// group child would bypass that assembly and bare-load the factory function,
// so declaring them inside a group is rejected here. "reminders" reads the
// current permission mode through the settings channel threaded from
// composePlugins (getPermissionMode), not from group config. "memory" reads the
// two memory roots through getters threaded from composePlugins
// (getUserRoot/getProjectRoot), likewise not from group config. "hooks" reads the
// merged top-level "hooks" declarations (project layer over user layer,
// from the same resolveBuiltinSet pass) plus the per-composition workspace
// root through getters — never from group config — and the host shutdown
// getter (batch 5 fix 1) rides the same channel into its stop face. "team"
// receives the teammate delivery port bound to the composing route session's
// identity (createTeammatePort + composePlugins' session identity) — never
// from group config. "ask" receives the ask-user port bound the same way
// (createAskUserPort + the same session identity) — the ask_user question
// bridge is host-owned, so a group child cannot bare-load the factory either.
// "fs"/"shell" receive the settings-snapshot tool configs
// (enhancedFindGrep/terminalShell — same composePlugins channel).
const FACTORY_ONLY_BUILTINS = new Set(["creation", "reminders", "memory", "hooks", "team", "ask", "fs", "shell"]);

/**
 * fs 工厂入参（当次 settings 快照 → 工具行为）：
 * enhancedFindGrep（默认开）→ "auto" 探测外部搜索引擎（回退 Node 扫描），
 * 关闭 → "builtin" 恒走内置 Node 扫描。
 */
export function fsFactoryConfigFor(settings?: HarnessSettings): FsPluginConfig {
  return {
    searchEngine: settings?.enhancedFindGrep === false ? "builtin" : "auto",
  };
}

/**
 * shell 工厂入参：terminalShell（默认 "auto"）经 terminal-pty 解析为命令
 * shell 前缀模板（win32 auto 优先 Git Bash --login -c，回退 comspec
 * /d /s /c；POSIX 恒 sh -c）。tools-shell 只消费模板，不感知 shell 种类。
 */
export function shellFactoryConfigFor(settings?: HarnessSettings): ShellPluginConfig {
  return { commandShell: resolveCommandShell(settings?.terminalShell ?? "auto") };
}

/** composePlugins 装配进 fs/shell 工厂条目的配置袋（同一次 settings 快照）。 */
export interface BuiltinToolFactoryConfigs {
  fs: FsPluginConfig;
  shell: ShellPluginConfig;
}

async function resolveGroupEntries(
  boot: PluginBoot,
  entries: readonly unknown[],
  config: InnocenceConfig,
  workspaceRoot: string,
  ownerId: string,
): Promise<ResolvedGroupChild[]> {
  const resolved: ResolvedGroupChild[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`loader group entry "${ownerId}" has invalid child`);
    }
    const child = raw as import("@innocenceharness/kernel-loader").EntryOptions;
    if (!validGroupSegment(child.id) ||
      (child.name !== undefined && (typeof child.name !== "string" || child.name.trim().length === 0)) ||
      (child.disabled !== undefined && typeof child.disabled !== "boolean")) {
      throw new Error(`loader group entry "${ownerId}" has invalid child`);
    }
    const options = groupChildOptions(child);
    if (options.disabled) {
      resolved.push(options);
      continue;
    }
    const childName = options.name ?? options.id;
    if (FACTORY_ONLY_BUILTINS.has(childName)) {
      throw new Error(`loader group entry "${ownerId}" declares factory-only builtin "${childName}"; declare it at top level instead`);
    }
    if (options.name === "skills" || options.name === "kernel:skills") {
      options.plugin = factoryPlugin(boot, "skills", () => factoryConfig("skills", options.config, workspaceRoot, config));
    } else if (options.name === "mcp" || options.name === "kernel:mcp") {
      options.plugin = factoryPlugin(boot, "mcp", () => factoryConfig("mcp", options.config, workspaceRoot, config));
    } else if (options.name === "kernel:group") {
      const nested = groupConfigOf(options.id, options.config);
      const nestedEntries = await resolveGroupEntries(boot, nested.entries, config, workspaceRoot, nested.id);
      options.plugin = boot.spine.group.createGroupPlugin({ id: nested.id, entries: nestedEntries });
    }
    resolved.push(options);
  }
  return resolved;
}

async function builtinLoaderEntryFor(
  boot: PluginBoot,
  entry: import("@innocenceharness/kernel-loader").EntryOptions,
  config: InnocenceConfig,
  workspaceRoot: string,
  resolveUserPluginRoot: () => string,
  resolvePermissionMode: () => string,
  hooksConfig: unknown,
  isHostShuttingDown: (() => boolean) | undefined,
  ecosystemPlugin?: ObjectPlugin,
  sessionIdentity?: ComposeSessionIdentity,
  createTeammatePort?: (identity: ComposeSessionIdentity) => SendToTeammatePort,
  createAskUserPort?: (identity: ComposeSessionIdentity) => AskUserPort,
  reminderState?: {
    getSessionUsage?: () => UsageMetadata | undefined;
    isContinuationSession?: () => boolean;
  },
  toolFactoryConfigs?: BuiltinToolFactoryConfigs,
): Promise<SessionLoaderPlugin> {
  const id = entry.id;
  let plugin: ObjectPlugin | undefined;
  if (!entry.disabled && ecosystemPlugin) {
    // 外部生态布局条目：宿主适配器包装的插件对象直接挂到
    // loader 条目（同 skills/mcp 工厂的 plugin 携带机制，绕过双根
    // resolver——该布局无 dist/index.js，直载必失败）。native 条目不传
    // 适配器，走既有 resolver 路径（零改动）。
    plugin = ecosystemPlugin;
  } else if (!entry.disabled && id === "fs") {
    // Factory builtin like skills/mcp: the staged default export is the fs
    // factory; the config comes from the settings snapshot composePlugins
    // received for this session build (enhancedFindGrep — absent
    // settings = the zero-config defaults, which match the settings defaults).
    plugin = factoryPlugin(boot, "fs", () => toolFactoryConfigs?.fs ?? {});
  } else if (!entry.disabled && id === "shell") {
    // Same factory shape as fs: the staged default export is the shell
    // factory; commandShell is the terminalShell snapshot resolved through
    // terminal-pty by composePlugins (absent settings = platform default).
    plugin = factoryPlugin(boot, "shell", () => toolFactoryConfigs?.shell ?? {});
  } else if (!entry.disabled && id === "skills") {
    plugin = factoryPlugin(boot, "skills", () => factoryConfig("skills", entry.config, workspaceRoot, config));
  } else if (!entry.disabled && id === "mcp") {
    plugin = factoryPlugin(boot, "mcp", () => factoryConfig("mcp", entry.config, workspaceRoot, config));
  } else if (!entry.disabled && id === "creation") {
    // Factory builtin like skills/mcp: the staged default export is a factory
    // needing the host-resolved user plugin root (creation-mode directory
    // projection target and install_user_plugin destination). Falls back to
    // the same default root semantics as compose's defaultUserPluginRoot().
    // The staging id "creation" equals the registered agent mode id (switcher
    // ⇄ session resolution invariant).
    plugin = factoryPlugin(boot, "creation", () => ({ userRoot: resolveUserPluginRoot() }));
  } else if (!entry.disabled && id === "reminders") {
    // Same factory shape as creation: the staged default export is the
    // reminders factory, and the permission-mode getter comes from the
    // settings snapshot composePlugins received for this session build
    // (absent settings fall back to "auto" — no reminders gated on plan).
    // The session-state getters (batch 4F) arrive session-bound from the
    // same pass: cumulative usage for any route, continuation only on the
    // main route (where the runtime re-seeds stored transcripts).
    plugin = factoryPlugin(boot, "reminders", () => ({
      getPermissionMode: () => resolvePermissionMode(),
      ...(reminderState?.getSessionUsage ? { getSessionUsage: reminderState.getSessionUsage } : {}),
      ...(reminderState?.isContinuationSession
        ? { isContinuationSession: reminderState.isContinuationSession }
        : {}),
    }));
  } else if (!entry.disabled && id === "memory") {
    // Same factory shape as creation/reminders: the staged default export is
    // the memory plugin factory, and the two memory roots resolve per call —
    // user entries land under the user data root (~/.innocence/memory),
    // project entries under the workspace's .innocence/memory; the plugin's
    // merged index reads the user root first (user shadows project on equal
    // ids, matching the resolver's dual-root direction).
    plugin = factoryPlugin(boot, "memory", () => ({
      getUserRoot: () => path.join(os.homedir(), ".innocence"),
      getProjectRoot: () => path.join(workspaceRoot, ".innocence"),
    }));
  } else if (!entry.disabled && id === "hooks") {
    // Same factory shape as creation/reminders/memory: the staged default
    // export is the hooks plugin factory. The merged top-level "hooks"
    // declarations (project yml over user cordis.yml, atomic key override —
    // from the same resolveBuiltinSet pass that produced this entry, so the
    // toggle layer and the hook declarations share one layer snapshot) and
    // the per-composition workspace root (every hook command's cwd) thread
    // through getters; no declarations means an empty hook set — the plugin
    // still mounts and all three faces no-op. The host shutdown getter
    // (batch 5 fix 1) rides the same getter channel: while the host's quit
    // handshake has started, the stop face skips entirely so an exiting
    // process never spawns fresh hook children during session unwind.
    plugin = factoryPlugin(boot, "hooks", () => ({
      getHooksConfig: () => Promise.resolve(hooksConfig),
      getWorkspaceRoot: () => workspaceRoot,
      ...(isHostShuttingDown ? { isHostShuttingDown } : {}),
    }));
  } else if (!entry.disabled && id === "team") {
    // Same factory shape as creation/reminders/memory/hooks: the staged
    // default export is the team plugin factory. The host injects the
    // sendToTeammate port bound to THIS route session's identity (a task's
    // named routes are the teammate namespace); without the host hook — or
    // without session identity — the plugin still mounts and every
    // send_message answers the no-teammates error.
    plugin = factoryPlugin(boot, "team", () => ({
      sendToTeammate:
        createTeammatePort && sessionIdentity
          ? createTeammatePort(sessionIdentity)
          : unavailableTeammatePort,
    }));
  } else if (!entry.disabled && id === "ask") {
    // Same factory shape as team: the staged default export is the ask plugin
    // factory. The host injects the askUser port bound to THIS route session's
    // identity (question cards attribute to the asking session); without the
    // host hook — or without session identity — the plugin still mounts and
    // every ask_user answers the no-question-surface error.
    plugin = factoryPlugin(boot, "ask", () => ({
      askUser:
        createAskUserPort && sessionIdentity
          ? createAskUserPort(sessionIdentity)
          : unavailableAskUserPort,
    }));
  } else if (!entry.disabled && id.startsWith("group:")) {
    const group = groupConfigOf(id, entry.config);
    const children = await resolveGroupEntries(boot, group.entries, config, workspaceRoot, group.id);
    plugin = boot.spine.group.createGroupPlugin({ id: group.id, entries: children });
  }
  return {
    name: entry.name,
    options: entry,
    resolver: boot.moduleResolver,
    ...(plugin ? { plugin } : {}),
    core: id === "fs" || id === "shell",
    ...(id.startsWith("group:") ? { abortOnFailure: true } : {}),
  };
}

/**
 * Agent 模式目录投影（IPC agents:modes 载荷源）：manifest 与用户扫描描述
 * 符去重合并（manifest 优先——同 id 时清单条目胜出），仅保留 kind
 * "agent-mode" 条目；恒含 default 兜底（无任何模式插件时目录仍可用，
 * 不与显式 default 描述符重复）。title 缺省回落 id。纯函数、无 IO。
 */
export function projectAgentModes(
  manifest: readonly PluginDescriptor[],
  userDescriptors: readonly PluginDescriptor[],
): AgentModeInfo[] {
  const byId = new Map<string, AgentModeInfo>();
  for (const descriptor of [...manifest, ...userDescriptors]) {
    if (descriptor.kind !== "agent-mode" || byId.has(descriptor.id)) continue;
    byId.set(descriptor.id, {
      id: descriptor.id,
      title: descriptor.title ?? descriptor.id,
      ...(descriptor.description ? { description: descriptor.description } : {}),
    });
  }
  if (!byId.has("default")) byId.set("default", { id: "default", title: "Default" });
  return [...byId.values()];
}

/**
 * Host composition root: one workspace's plugin set — workspace tools,
 * subagents, project permission rules, project skills, MCP servers, the
 * session todo tool and the settings-based provider. Declarative assembly:
 * staging manifest descriptors + project plugins.yml + user toggles →
 * resolvePluginSet（本地拷贝）→ 按清单 id 从 staging 双根磁盘装载（boot 的
 * FileModuleResolver；用户根在前）。Instantiation order matches the
 * pre-distribution static composition exactly; the provider is assembled per
 * session and wrapped as a kernel provider plugin (name "provider") so the
 * session resolves it through the providers registry; the project-rules
 * plugin remains a legacy plugin the session kernel adapts. fs/shell are
 * core and the project-rules/provider plugins are not toggleable, so all of
 * them are always present; skipped plugins and resolver warnings surface
 * through the logger.
 */
export function createSessionComposition(
  options: SessionCompositionOptions,
): SessionComposition {
  // Lazy boot singleton: the first session assembly triggers creation
  // (a missing staging tree surfaces on the session-build path, never blocks
  // app startup); settings/workspaceRoot are not captured here — each boot
  // attempt reads them fresh (settings-rebuild semantics unchanged).
  let bootPromise: Promise<PluginBoot> | undefined;

  // 用户根扫描现算（每次调用重扫，不缓存——新装插件下次会话构建/清单与目录
  // 拉取即生效）：userRoot 走宿主钩子优先、缺省回落 compose 的
  // defaultUserPluginRoot()（与 boot 的 resolver 双根一致）；目录非法/不可读
  // 一律降级为告警，不阻断调用方。
  const scanCurrentUserRoot = async (): Promise<UserPluginScanResult> => {
    const scanned = await scanUserPlugins(
      options.getUserPluginRoot?.() ?? defaultUserPluginRoot(),
      [nativeProbe, claudeCodeProbe],
    );
    for (const warning of scanned.warnings) {
      options.log("warn", "user plugin scan", { warning });
    }
    return scanned;
  };

  function ensureBoot(): Promise<PluginBoot> {
    bootPromise ??= createPluginBoot({
      ...options.resolvePaths(),
      workspaceRoot: options.getWorkspaceRoot(),
      userRoot: options.getUserPluginRoot?.(),
      allowedGroupNames: options.getAllowedGroupNames?.(),
      enableHmrWatcher: options.enableHmrWatcher ?? process.env.NODE_ENV !== "production",
      ...(options.createHmrWatcher ? { hmrWatcherFactory: options.createHmrWatcher } : {}),
      ...(options.onPluginClientChange ? { onPluginClientChange: options.onPluginClientChange } : {}),
    }).catch((error: unknown) => {
      // A failed boot must not pin the memo — the next session build retries.
      // The kernel/spine module caches intentionally SURVIVE (successful
      // imports keep one module identity per process; failed ones are not
      // memoized in the loaders themselves).
      bootPromise = undefined;
      throw error;
    });
    return bootPromise;
  }

  return {
    ensureBoot,
    async disposePluginBoot(): Promise<void> {
      const pending = bootPromise;
      bootPromise = undefined;
      const boot = await pending?.catch(() => undefined);
      if (!boot) return;
      try {
        await boot.dispose();
      } catch (err) {
        options.log("warn", "plugin boot dispose failed", { error: String(err) });
      }
    },
    async pluginInventory(input): Promise<PluginInventoryEntry[]> {
      const boot = await ensureBoot();
      // 扫描并入：用户插件在 plugins:list 行可见，开关态投影随解析自动接管
      // （与 composePlugins 同一扫描根、同一 manifest 优先去重语义）。
      const scanned = await scanCurrentUserRoot();
      return boot.pluginInventory({ ...input, extraDescriptors: scanned.descriptors });
    },
    async composePlugins(
      workspaceRoot: string,
      userToggles?: PluginToggleSource,
      settings?: HarnessSettings,
      sessionIdentity?: ComposeSessionIdentity,
      sessionSurface?: {
        isolatedWorktree?: boolean;
        workbenchFocus?: () => WorkbenchFocusInput | undefined;
        backgroundIsolation?: boolean;
      },
    ): Promise<SessionPlugin[]> {
      const boot = await ensureBoot();
      // creation 工厂入参与用户根扫描共用同一路径解析：宿主钩子优先，
      // 缺省回落 compose 的 defaultUserPluginRoot()（~/.innocence/plugins，
      // 与 boot 的 resolver 双根一致——用户目录可影子覆盖模块本体）。
      const resolveUserPluginRoot = (): string =>
        options.getUserPluginRoot?.() ?? defaultUserPluginRoot();
      // reminders 工厂的许可档读取：复用 composePlugins 既有 settings 通道
      // （宿主 pluginsForSession 每次会话组装传当次 settings 快照）；getter
      // 每轮调用现读该快照，缺省回落 "auto"（无 settings 的组装面不注入
      // plan 档提醒）。快照语义与 provider 组装一致：会话中途改档下一会话
      // 生效。
      const resolvePermissionMode = (): string => settings?.permissionMode ?? "auto";
      // fs/shell 工厂入参：与 provider/权限档同一 settings 快照通道——会话
      // 中途改设置下一会话生效（settingsKey 重建语义）。terminalShell 经
      // terminal-pty 现解析（auto 的 Git Bash 探测随快照现取）。
      const toolFactoryConfigs: BuiltinToolFactoryConfigs = {
        fs: fsFactoryConfigFor(settings),
        shell: shellFactoryConfigFor(settings),
      };
      // reminders 工厂的会话状态 getter（批次 4F）：usage 对任意路由的会话身份
      // 绑定（按会话累计，与路由无关）；continuation 仅 main 路由（transcript
      // 种子只在 main 路由回灌——runtime-session 重建路径，非 main 路由首轮
      // 历史恒空，误报会误导核对行为）。无 sessionIdentity（无身份组装面）或
      // 宿主未供端口时 getter 缺省，两个提醒保持未武装。
      let reminderState:
        | {
            getSessionUsage?: () => UsageMetadata | undefined;
            isContinuationSession?: () => boolean;
          }
        | undefined;
      if (sessionIdentity) {
        const boundSessionId = sessionIdentity.sessionId;
        reminderState = {
          ...(options.getSessionUsage
            ? { getSessionUsage: () => options.getSessionUsage!(boundSessionId) }
            : {}),
          ...(options.isContinuationSession && sessionIdentity.routeId === DEFAULT_ROUTE_ID
            ? { isContinuationSession: () => options.isContinuationSession!(boundSessionId) }
            : {}),
        };
        if (!reminderState.getSessionUsage && !reminderState.isContinuationSession) {
          reminderState = undefined;
        }
      }
      // 用户根扫描现算（不缓存，与项目配置读取并行）；解析依赖扫描结果，
      // 故 resolveBuiltinSet 在其后串行。
      const [config, scanned] = await Promise.all([
        loadInnocenceConfig(workspaceRoot),
        scanCurrentUserRoot(),
      ]);
      // 扫描描述符并入解析（manifest id 优先去重，由 boot 的
      // resolveBuiltinSet 完成）：用户插件与清单条目一同走 toggles/configs/
      // 依赖闭包——可经 settings 开关或 ~/.innocence/cordis.yml 关闭，关闭即
      // 产出 disabled 条目、不装载；同 id 时清单描述符胜出（用户目录对模块
      // 本体的影子覆盖由 resolver 根序保证）。
      const resolved = await boot.resolveBuiltinSet({
        workspaceRoot,
        userToggles,
        knownGroupNames: options.getAllowedGroupNames?.(),
        extraDescriptors: scanned.descriptors,
        // yml 损坏/未知键告警必须进 userData/logs，而非 console 兜底。
        logger: (level, msg, data) =>
          options.log(level === "error" ? "error" : "warn", msg, data),
      });
      for (const { id, reason, via } of resolved.skipped) {
        options.log("info", "plugin skipped", { id, reason, via });
      }
      for (const warning of resolved.warnings) options.log("warn", "plugin set", warning);

      // 外部生态布局条目目录：扫描描述符 format 标记 → 用户根下同名目录
      // （与扫描同源）。清单 id 冲突的扫描描述符在 resolveBuiltinSet 并入时
      // 已被丢弃（mergeExtraDescriptors 清单优先）——这里同样减去清单 id：
      // 同名外部目录不得顶替清单条目的工厂/core 装载（skills 静默无技能、
      // core 失败中止构建）。native 条目不在表中——装载路径零改动；
      // descriptor 停用走 resolveBuiltinSet 既有语义（条目不组装）。
      const manifestIds = new Set(
        (await readManifest(boot.builtinRoot)).map((descriptor) => descriptor.id),
      );
      const ecosystemDirs = new Map<string, string>(
        scanned.descriptors
          .filter((descriptor) => descriptor.format === "claude-code" && !manifestIds.has(descriptor.id))
          .map((descriptor) => [descriptor.id, path.join(resolveUserPluginRoot(), descriptor.id)] as const),
      );

      const plugins: SessionPlugin[] = [];
      for (const entry of resolved.entries) {
        if (entry.id === "example" || entry.disabled) continue;
        const ecosystemDir = ecosystemDirs.get(entry.id);
        plugins.push(await builtinLoaderEntryFor(
          boot,
          entry,
          config,
          workspaceRoot,
          resolveUserPluginRoot,
          resolvePermissionMode,
          // 顶层 hooks 声明（项目覆盖用户的合并值，同一次 resolveBuiltinSet
          // 层快照）——hooks 工厂分支经 getter 注入插件，不进 entry.config；
          // 宿主关机旗标 getter（批次 5 修复 1）同经该通道进 stop 面。
          resolved.hooks,
          options.isHostShuttingDown,
          ecosystemDir !== undefined
            ? createEcosystemAdapterPlugin(
              entry.id,
              ecosystemDir,
              (level, channel, detail) => options.log(level, channel, detail),
            )
            : undefined,
          sessionIdentity,
          options.createTeammatePort,
          options.createAskUserPort,
          reminderState,
          toolFactoryConfigs,
        ));
      }
      // 项目权限规则在声明式 builtin 集合之外（不可关闭），恒定注入。
      plugins.push(projectRulesPlugin(config.permissions));
      // S2a 工作树会话感知面：有效根为任务工作树的会话附加隔离纪律片段。
      plugins.push(worktreeIsolationPlugin(sessionSurface?.isolatedWorktree === true));
      // S4 工作台焦点注记（恒挂载；无焦点/会话不匹配时中间件零行为）。
      plugins.push(workbenchFocusPlugin(sessionSurface?.workbenchFocus ?? (() => undefined)));
      // A:58 EnterWorktree 半边：仅武装会话（后台作业）注入写隔离面。
      if (sessionSurface?.backgroundIsolation === true) {
        plugins.push(createWorktreeFencePlugin());
      }
      // Provider assembly per session remains a host concern outside the builtin
      // manifest; it is still mounted through the native/session chokepoint.
      plugins.push(createProviderPlugin(await buildProviderFromSettings(boot, settings ?? DEFAULT_SETTINGS)));
      return plugins;
    },
    async agentModes(): Promise<AgentModeInfo[]> {
      // 现算：manifest（readManifest 与 boot 同一读取路径，kind 已透传）+
      // 用户根扫描（并行）→ 投影。不缓存：新装模式插件下次目录拉取即生效。
      // 目录不过滤已停用的模式（协调者裁定）：目录是可用性提示而非保证——
      // 模式插件停用时其模式片段不参与系统提示词组装（选中该模式即回落
      // 共享/基础提示词，非法模式 id 另在会话构建处回落 "default"），与既有
      // 回退语义一致，故此处不加 toggle 过滤。
      const { builtinRoot } = options.resolvePaths();
      const [manifest, scanned] = await Promise.all([
        readManifest(builtinRoot),
        scanCurrentUserRoot(),
      ]);
      return projectAgentModes(manifest, scanned.descriptors);
    },
  };
}

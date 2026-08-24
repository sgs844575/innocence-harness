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
import { createOpenAIProvider } from "@innocenceharness/provider-openai";
import { createAnthropicProvider } from "@innocenceharness/provider-anthropic";
import { createMockProvider } from "@innocenceharness/provider-mock";
import {
  DEFAULT_SETTINGS,
  MOCK_GREETING,
  resolveActive,
  type HarnessPlugin,
  type HarnessSettings,
  type SessionPlugin,
  type SessionLoaderPlugin,
} from "@innocenceharness/harness-electron";
import type { Provider } from "@innocenceharness/harness-providers";
import type { ObjectPlugin } from "@innocenceharness/kernel";
import { createPluginBoot, type PluginBoot } from "./compose";
import type { HostHmrWatcher } from "./hmrWatcher";
import type { PluginToggleSource } from "../plugin-toggles-local";
import type { PluginInventoryEntry } from "../plugin-inventory";

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
  /** One workspace's session plugin set (staging manifest + toggles + disk). */
  composePlugins(
    workspaceRoot: string,
    userToggles?: PluginToggleSource,
    settings?: HarnessSettings,
  ): Promise<SessionPlugin[]>;
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

/** Provider instance from the active settings profile. */
function buildProviderFromSettings(settings: HarnessSettings): Provider {
  const active = resolveActive(settings);
  // 空串 = 跟随模型默认（不传参）；off 交给 provider 层解释（openai 省略、anthropic 不开启）。
  const reasoningEffort = settings.reasoningEffort || undefined;
  switch (active.kind) {
    case "openai":
      return createOpenAIProvider({
        apiKey: active.apiKey || undefined,
        baseURL: active.baseURL || undefined,
        model: active.model,
        reasoningEffort,
      });
    case "anthropic":
      return createAnthropicProvider({
        apiKey: active.apiKey || undefined,
        model: active.model,
        reasoningEffort,
      });
    default:
      return createMockProvider({ id: "mock", turns: [], exhaustedText: MOCK_GREETING });
  }
}

/** Resolve a host-only factory lazily at the loader entry boundary. */
function factoryPlugin(
  boot: PluginBoot,
  id: "skills" | "mcp",
  options: () => { dirs: string[] } | { servers: Record<string, unknown> },
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
): Promise<SessionLoaderPlugin> {
  const id = entry.id;
  let plugin: ObjectPlugin | undefined;
  if (!entry.disabled && id === "skills") {
    plugin = factoryPlugin(boot, "skills", () => factoryConfig("skills", entry.config, workspaceRoot, config));
  } else if (!entry.disabled && id === "mcp") {
    plugin = factoryPlugin(boot, "mcp", () => factoryConfig("mcp", entry.config, workspaceRoot, config));
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
      return boot.pluginInventory(input);
    },
    async composePlugins(
      workspaceRoot: string,
      userToggles?: PluginToggleSource,
      settings?: HarnessSettings,
    ): Promise<SessionPlugin[]> {
      const boot = await ensureBoot();
      const [config, resolved] = await Promise.all([
        loadInnocenceConfig(workspaceRoot),
        boot.resolveBuiltinSet({
          workspaceRoot,
          userToggles,
          knownGroupNames: options.getAllowedGroupNames?.(),
          // yml 损坏/未知键告警必须进 userData/logs，而非 console 兜底。
          logger: (level, msg, data) =>
            options.log(level === "error" ? "error" : "warn", msg, data),
        }),
      ]);
      for (const { id, reason, via } of resolved.skipped) {
        options.log("info", "plugin skipped", { id, reason, via });
      }
      for (const warning of resolved.warnings) options.log("warn", "plugin set", warning);

      const plugins: SessionPlugin[] = [];
      for (const entry of resolved.entries) {
        if (entry.id === "example" || entry.disabled) continue;
        plugins.push(await builtinLoaderEntryFor(boot, entry, config, workspaceRoot));
      }
      // 项目权限规则在声明式 builtin 集合之外（不可关闭），恒定注入。
      plugins.push(projectRulesPlugin(config.permissions));
      // Provider assembly per session remains a host concern outside the builtin
      // manifest; it is still mounted through the native/session chokepoint.
      plugins.push(createProviderPlugin(buildProviderFromSettings(settings ?? DEFAULT_SETTINGS)));
      return plugins;
    },
  };
}

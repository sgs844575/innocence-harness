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
} from "@innocencecode/harness-permissions";
import { createProviderPlugin } from "@innocencecode/harness-providers";
import { createOpenAIProvider } from "@innocencecode/provider-openai";
import { createAnthropicProvider } from "@innocencecode/provider-anthropic";
import { createMockProvider } from "@innocencecode/provider-mock";
import {
  DEFAULT_SETTINGS,
  MOCK_GREETING,
  resolveActive,
  type HarnessPlugin,
  type HarnessSettings,
  type SessionPlugin,
  type SessionLoaderPlugin,
} from "@innocencecode/harness-electron";
import type { Provider } from "@innocencecode/harness-providers";
import type { ObjectPlugin } from "@innocencecode/kernel";
import { createPluginBoot, type PluginBoot } from "./compose";
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

/** Resolve a host-only factory plugin before handing it to the loader. */
async function resolveFactoryPlugin(
  boot: PluginBoot,
  id: "skills" | "mcp",
  options: { dirs: string[] } | { servers: Record<string, unknown> },
): Promise<ObjectPlugin> {
  const factory = await boot.importPlugin(id);
  const plugin = id === "skills"
    ? (factory as (input: { dirs: string[] }) => ObjectPlugin)(options as { dirs: string[] })
    : (factory as (input: { servers: Record<string, unknown> }) => ObjectPlugin)(options as { servers: Record<string, unknown> });
  if (!plugin || typeof plugin.apply !== "function") {
    throw new Error(`builtin plugin "${id}" factory did not return a native plugin`);
  }
  return plugin;
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
  entry: import("@innocencecode/kernel-loader").EntryOptions,
  config: InnocenceConfig,
  workspaceRoot: string,
): ResolvedGroupChild {
  const child: ResolvedGroupChild = { ...entry, name: entry.name ?? entry.id };
  if (child.name === "skills" || child.name === "kernel:skills") {
    const dirs = (child.config as { dirs?: unknown } | undefined)?.dirs;
    child.config = { dirs: Array.isArray(dirs) && dirs.every((dir) => typeof dir === "string")
      ? dirs as string[]
      : [path.join(workspaceRoot, ".innocence", "skills"), path.join(os.homedir(), ".innocence", "skills")] };
  } else if (child.name === "mcp" || child.name === "kernel:mcp") {
    const servers = (child.config as { servers?: unknown } | undefined)?.servers;
    child.config = { servers: servers && typeof servers === "object" && !Array.isArray(servers)
      ? servers as Record<string, unknown>
      : (config.mcpServers ?? {}) as Record<string, unknown> };
  }
  return child;
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
    const child = raw as import("@innocencecode/kernel-loader").EntryOptions;
    if (!validGroupSegment(child.id) ||
      (child.name !== undefined && (typeof child.name !== "string" || child.name.trim().length === 0)) ||
      (child.disabled !== undefined && typeof child.disabled !== "boolean")) {
      throw new Error(`loader group entry "${ownerId}" has invalid child`);
    }
    const options = groupChildOptions(child, config, workspaceRoot);
    if (options.disabled) {
      resolved.push(options);
      continue;
    }
    if (options.name === "skills" || options.name === "kernel:skills") {
      options.plugin = await resolveFactoryPlugin(boot, "skills", options.config as { dirs: string[] });
    } else if (options.name === "mcp" || options.name === "kernel:mcp") {
      options.plugin = await resolveFactoryPlugin(boot, "mcp", options.config as { servers: Record<string, unknown> });
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
  entry: import("@innocencecode/kernel-loader").EntryOptions,
  config: InnocenceConfig,
  workspaceRoot: string,
): Promise<SessionLoaderPlugin> {
  const id = entry.id;
  let plugin: ObjectPlugin | undefined;
  if (!entry.disabled && id === "skills") {
    const configuredDirs = (entry.config as { dirs?: unknown } | undefined)?.dirs;
    const dirs = Array.isArray(configuredDirs) && configuredDirs.every((dir) => typeof dir === "string")
      ? configuredDirs as string[]
      : [path.join(workspaceRoot, ".innocence", "skills"), path.join(os.homedir(), ".innocence", "skills")];
    plugin = await resolveFactoryPlugin(boot, "skills", { dirs });
  } else if (!entry.disabled && id === "mcp") {
    const configuredServers = (entry.config as { servers?: unknown } | undefined)?.servers;
    const servers = configuredServers && typeof configuredServers === "object" && !Array.isArray(configuredServers)
      ? configuredServers as Record<string, unknown>
      : (config.mcpServers ?? {}) as Record<string, unknown>;
    plugin = await resolveFactoryPlugin(boot, "mcp", { servers });
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
      allowedGroupNames: options.getAllowedGroupNames?.(),
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

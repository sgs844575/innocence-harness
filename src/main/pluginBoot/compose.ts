// Plugin boot composition: one host-owned kernel root (created through the
// dynamically loaded staging kernel), the registration spine mounted on it
// (the same staging module identities the disk-loaded capability plugins
// resolve against), the kernel loader plus its dual-root file resolver (user
// plugins dir first, then the built-in staging root), and the declarative
// builtin-set resolution (manifest.json + two-level config layers →
// resolveEntries). Capability plugins are imported through the resolver;
// route sessions mount them inside per-route kernel scopes (createSessionScope).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type * as KernelModule from "@innocencecode/kernel";
import type { SessionSpineSuite } from "@innocencecode/harness-electron";
import type { EntryOptions } from "@innocencecode/kernel-loader";
import { loadKernelSuite } from "./spineLoader";
import type { Kernel } from "./kernelLoader";
import {
  type PluginDescriptor,
  type PluginToggleSource,
} from "../plugin-toggles-local";
import { resolveEntries, type ConfigSpecs, type ResolvedEntries } from "./pluginEntries";
import { type SchemaSpec } from "@innocencecode/kernel-schema";
import { loadConfigLayerPair, type ConfigLogger } from "./configSources";
import { projectPluginInventory, type PluginInventoryEntry } from "../plugin-inventory";
import { createHostHmrWatcher, type HostHmrWatcher } from "./hmrWatcher";

type KernelContext = KernelModule.Context;
type KernelScope = KernelModule.ScopeHandle;

/** One booted plugin host: the root context, loader and resolution helpers. */
export interface PluginBoot {
  /** The loaded kernel module (single instance; Context/createScope/... symbols). */
  readonly kernel: Kernel;
  /** The loaded spine suite (single instance; the mount face of this boot). */
  readonly spine: SessionSpineSuite;
  /** Boot root context: spine skeleton + loader live here for the app lifetime. */
  readonly root: KernelContext;
  /** Directory the builtin plugin set is resolved from (staging/plugins). */
  readonly builtinRoot: string;
  /** User plugin root (`~/.innocence/plugins` unless overridden). */
  readonly userRoot: string;
  /**
   * Resolve the builtin capability set for one workspace (declarative face):
   * manifest descriptors + project `.innocence/plugins.yml` + user settings
   * toggles with `~/.innocence/cordis.yml` configs → resolveEntries (same
   * toggle semantics: project overrides user; core stays on; dependency
   * closure). Skipped plugins still produce disabled entries (entries() face).
   * An empty workspaceRoot skips the project layer (no cwd-relative reads).
   */
  resolveBuiltinSet(options: {
    workspaceRoot?: string;
    userToggles?: PluginToggleSource;
    knownGroupNames?: readonly string[];
    logger?: (level: "info" | "warn" | "error", msg: string, data?: unknown) => void;
  }): Promise<ResolvedEntries>;
  /**
   * Manifest projection for the settings inventory (IPC plugins:list):
   * boot-time descriptor metadata + a FRESH resolveBuiltinSet run per call —
   * settings/toggle changes are reflected immediately, never a stale snapshot.
   */
  pluginInventory(options: {
    workspaceRoot?: string;
    userToggles?: PluginToggleSource;
  }): Promise<PluginInventoryEntry[]>;
  /** The dual-root resolver shared by route-scope loaders. */
  readonly moduleResolver: { version: string; import(specifier: string): Promise<unknown> };
  /**
   * Import one builtin plugin module through the dual-root resolver: the
   * module's default export when it has one (plugin object, or the factory
   * for skills/mcp), else the namespace. Host code configures factories.
   */
  importPlugin(id: string): Promise<unknown>;
  /**
   * Mount one plugin-shaped builtin at the boot root via `loader.create`
   * (the full disk chain: resolver import → plugin-shape validation → apply
   * against the root spine). Factory builtins (skills/mcp) must instead be
   * configured by the host and mounted per session — mounting a bare factory
   * as a function plugin would silently register nothing.
   */
  mountAtRoot(id: string): Promise<void>;
  /**
   * Declarative root mount of a resolved entry set: one loader entry per
   * plugin row (`boot-<id>`, config and disabled carried verbatim; disabled
   * entries short-circuit in the loader but stay visible in entries()).
   * Single-entry failures are isolated (recorded as warnings, never abort
   * the whole mount) — the boot root keeps whatever else mounted.
   */
  mountEntries(
    entries: readonly EntryOptions[],
    logger?: (level: "info" | "warn" | "error", msg: string, data?: unknown) => void,
  ): Promise<{ failures: string[] }>;
  /** Root loader tree entry ids (composite; `boot-<id>` rows), including
   *  disabled rows — the entries()-face projection of the declarative set. */
  loaderEntryIds(): string[];
  /** Create one route-session scope below the boot root (kernel createScope). */
  createSessionScope(): KernelScope;
  watchPlugin(id: string, fileOrDirectory: string, restart: () => Promise<void>): Promise<() => Promise<void>>;
  /** Unwind the boot root (app shutdown; cascades into live route scopes). */
  dispose(): Promise<void>;
}

/** Inputs of {@link createPluginBoot}. */
export interface PluginBootOptions {
  /** Absolute path of the staged kernel dist entry (dev or packaged). */
  kernelPath: string;
  /** Built-in plugin root (staging `plugins/` or packaged `resources/plugins`). */
  builtinRoot: string;
  /** User plugin root (`~/.innocence/plugins` unless overridden). */
  userRoot?: string;
  /** Registered group names used to validate configured group declarations. */
  allowedGroupNames?: readonly string[];
  /** Default workspace root recorded on the boot root (diagnostics anchor). */
  workspaceRoot?: string;
  /** Explicitly enable host file watching in development mode. */
  enableHmrWatcher?: boolean;
  /** Host HMR watcher factory; defaults to the real Node fs.watch adapter. */
  hmrWatcherFactory?: () => HostHmrWatcher;
}

const builtinConfigSpecs: ConfigSpecs = {
  skills: {
    type: "object",
    properties: {
      dirs: { spec: { type: "array", items: { type: "string" } } },
    },
  } satisfies SchemaSpec,
  mcp: {
    type: "object",
    properties: {
      servers: { spec: { type: "object" } },
    },
  } satisfies SchemaSpec,
};

/** Root-level permission decider: no UI exists at the boot root, so every
 *  ask fails closed. Route sessions carry their own UI-backed decider. */
const denyAllDecider = {
  ask: async () => "deny" as const,
};

/** Default user plugin root (`~/.innocence/plugins`): shared with the plugin
 *  scheme wiring so the loader resolver and the scheme serve the same roots. */
export function defaultUserPluginRoot(): string {
  return path.join(os.homedir(), ".innocence", "plugins");
}

/** Read and validate staging `manifest.json` (build:plugins artifact). */
async function readManifest(builtinRoot: string): Promise<PluginDescriptor[]> {
  const file = path.join(builtinRoot, "manifest.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    throw new Error(`builtin plugin manifest unreadable (${file}): ${String(err)}`);
  }
  const rows = (parsed as { plugins?: unknown }).plugins;
  if (!Array.isArray(rows)) {
    throw new Error(`builtin plugin manifest malformed (${file}): "plugins" must be an array`);
  }
  return rows.map((row) => {
    const descriptor = row as Partial<PluginDescriptor>;
    if (typeof descriptor.id !== "string" || !Array.isArray(descriptor.dependencies)) {
      throw new Error(`builtin plugin manifest malformed (${file}): bad descriptor`);
    }
    if (descriptor.title !== undefined && (typeof descriptor.title !== "string" || descriptor.title === "")) {
      throw new Error(`builtin plugin manifest malformed (${file}): bad title for "${descriptor.id}"`);
    }
    if (descriptor.client !== undefined && typeof descriptor.client !== "boolean") {
      throw new Error(`builtin plugin manifest malformed (${file}): bad client flag for "${descriptor.id}"`);
    }
    if (descriptor.toggleable !== undefined && typeof descriptor.toggleable !== "boolean") {
      throw new Error(`builtin plugin manifest malformed (${file}): bad toggleable flag for "${descriptor.id}"`);
    }
    return {
      id: descriptor.id,
      dependencies: descriptor.dependencies,
      ...(descriptor.core === true ? { core: true } : {}),
      ...(typeof descriptor.title === "string" ? { title: descriptor.title } : {}),
      ...(descriptor.client === true ? { client: true } : {}),
      ...(typeof descriptor.toggleable === "boolean" ? { toggleable: descriptor.toggleable } : {}),
    };
  });
}

/** 键空间投影（清单派生）：toggleable 条目的 id 集即开关键空间——旧
 *  manifest（无 toggleable 字段）缺省回落"非 core 即可开关"，语义等价。 */
export function toggleKeyspace(descriptors: readonly PluginDescriptor[]): string[] {
  return descriptors
    .filter((d) => (d.toggleable ?? d.core !== true) === true)
    .map((d) => d.id);
}

/** Register the include carrier as the `kernel:include` loader builtin (the
 *  config-tree carrier face). Dynamically imported from the staging tree; a
 *  missing dist or an unloadable carrier is a silent no-op (optional hook). */
async function attachIncludeBuiltin(
  loader: { builtins: Record<string, unknown> },
  kernelPath: string,
): Promise<void> {
  try {
    const includeEntry = path.join(
      path.dirname(kernelPath), "..", "kernel-include", "dist", "index.js",
    );
    const includeModule = (await import(
      (await import("node:url")).pathToFileURL(includeEntry).href
    )) as { Include?: unknown };
    if (includeModule && typeof includeModule.Include === "object") {
      loader.builtins.include = includeModule.Include;
    }
  } catch {
    // optional hook — absent carrier is not a boot failure
  }
}

/**
 * Boot the plugin host: load the staging kernel + spine suite (single
 * instances), mount the registration spine + loader on the root, attach the
 * dual-root resolver. Settings and per-workspace toggles are resolved per
 * session (settings rebuilds must observe fresh values), not captured here.
 */
export async function createPluginBoot(options: PluginBootOptions): Promise<PluginBoot> {
  const suite = await loadKernelSuite(options.kernelPath);
  const { kernel, spine, loader: loaderModule } = suite;
  const root = new kernel.Context();
  const userRoot = options.userRoot ?? defaultUserPluginRoot();
  if (options.workspaceRoot) root.baseUrl = options.workspaceRoot;

  // Registration spine (dynamically loaded from the same staging tree as the
  // kernel): the root-level skeleton exists so root-mounted plugins (loader
  // entries, smoke probes) can register; each route session still mounts its
  // own spine inside its scope and shadows these names. Root-level permission
  // asks have no UI to answer them — they fail closed (deny).
  await root.plugin(spine.logger.LoggerPlugin);
  await root.plugin(spine.timer.TimerPlugin);
  await root.plugin(spine.hmr.HmrPlugin);
  await root.plugin(spine.tools.ToolsPlugin);
  await root.plugin(
    spine.permissions.createPermissionsPlugin(
      spine.permissions.createPermissionsService({ mode: "ask", decider: denyAllDecider }),
    ),
  );
  await root.plugin(spine.providers.ProvidersPlugin);
  await root.plugin(spine.skills.SkillsPlugin);
  await root.plugin(spine.systemPrompt.SystemPromptPlugin);
  await root.plugin(spine.agents.AgentsPlugin);

  const loaderFiber = await root.plugin(loaderModule.Loader);
  const loader = loaderFiber.ctx.loader;
  const moduleResolver = loaderModule.createFileModuleResolver({ roots: [userRoot, options.builtinRoot] });
  loader.internal = moduleResolver;
  const groupBuiltin = {
    name: "group",
    apply(ctx: KernelContext) {
      const config = ctx.entry?.options.config;
      if (!config || typeof config !== "object" || !Array.isArray((config as { entries?: unknown }).entries)) {
        throw new Error("loader group entry has invalid config");
      }
      return spine.group.createGroupPlugin(config as Parameters<typeof spine.group.createGroupPlugin>[0]).apply(ctx);
    },
  };
  loader.builtins.group = groupBuiltin;

  // kernel:include builtin hook (optional by the task ruling): absent dist or
  // unloadable carrier degrades to a no-op — the boot never depends on it.
  await attachIncludeBuiltin(loader, options.kernelPath);

  const descriptors = await readManifest(options.builtinRoot);
  const hostHmrWatcher = options.enableHmrWatcher === true && process.env.NODE_ENV !== "production"
    ? (options.hmrWatcherFactory ?? (() => createHostHmrWatcher()))()
    : undefined;

  // Shared declarative resolution: manifest descriptors + project yml layer +
  // user layer (settings toggles over user cordis.yml). An empty workspaceRoot
  // means "no project layer" — never a cwd-relative read.
  const resolveBuiltinSet = async ({
    workspaceRoot,
    userToggles,
    knownGroupNames,
    logger,
  }: {
    workspaceRoot?: string;
    userToggles?: PluginToggleSource;
    knownGroupNames?: readonly string[];
    logger?: (level: "info" | "warn" | "error", msg: string, data?: unknown) => void;
  }): Promise<ResolvedEntries> => {
    const log: ConfigLogger = (level, msg, data) =>
      (logger ?? (() => {}))(level, msg, data);
    // 键空间清单派生：项目/用户 yml 的未知键校验用清单 id 集（configSources
    // 不再持有硬编码白名单）。
    const knownKeys = toggleKeyspace(descriptors);
    const { user, project } = await loadConfigLayerPair(
      os.homedir(),
      workspaceRoot,
      userToggles,
      log,
      knownKeys,
      knownGroupNames ?? options.allowedGroupNames,
    );
    return resolveEntries(descriptors, user, project, builtinConfigSpecs);
  };

  return {
    kernel,
    spine,
    root,
    builtinRoot: options.builtinRoot,
    userRoot,
    moduleResolver,
    resolveBuiltinSet,
    async pluginInventory({ workspaceRoot, userToggles }) {
      // 现算投影：每次调用重跑解析（toggles 变更即时反映）；描述符本身
      // 是 boot 时的 manifest 快照（随 staging 树固定）。
      return projectPluginInventory(descriptors, await resolveBuiltinSet({ workspaceRoot, userToggles }));
    },
    async importPlugin(id: string): Promise<unknown> {
      // The loader validates the plugin shape (object with apply, or a
      // function — which is how the skills/mcp factory defaults pass).
      return loader.importPlugin(id);
    },
    async mountAtRoot(id: string): Promise<void> {
      await loader.create({ id: `boot-${id}`, name: id });
    },
    async mountEntries(entries, logger = () => {}) {
      const failures: string[] = [];
      for (const entry of entries) {
        try {
          await loader.create({
            id: `boot-${entry.id}`,
            name: entry.name,
            ...(entry.config !== undefined ? { config: entry.config } : {}),
            ...(entry.disabled !== undefined ? { disabled: entry.disabled } : {}),
          });
        } catch (err) {
          failures.push(entry.id);
          logger("warn", `loader entry "${entry.id}" failed to mount; isolated`, {
            error: String(err),
          });
        }
      }
      // Aggregate settle for entries mounted by carriers (disabled entries
      // short-circuit; carrier-subtree failures surface here, also isolated).
      try {
        await loader.await();
      } catch (err) {
        logger("warn", "loader tree settle reported failures; isolated", { error: String(err) });
      }
      return { failures };
    },
    loaderEntryIds(): string[] {
      return [...loader.entries()].map((entry) => entry.id);
    },
    createSessionScope() {
      return kernel.createScope(root);
    },
    watchPlugin(id: string, fileOrDirectory: string, restart: () => Promise<void>) {
      if (!hostHmrWatcher) {
        return Promise.reject(new Error("host HMR watcher is not enabled"));
      }
      return hostHmrWatcher.watchPath(id, fileOrDirectory, restart);
    },
    async dispose() {
      let watcherError: unknown;
      try {
        await hostHmrWatcher?.dispose();
      } catch (error) {
        watcherError = error;
      } finally {
        await root.fiber.dispose();
      }
      if (watcherError !== undefined) throw watcherError;
    },
  };
}

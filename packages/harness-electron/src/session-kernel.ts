// Session kernel composition: mounts the spine service plugins on one kernel
// Context, loads the host plugins (kernel-native ones directly, legacy
// HarnessPlugins through the HarnessPluginAdapter), resolves the provider,
// mounts the session-owned services (ledger/processors and the spawner),
// asserts the spine skeleton, and rolls the whole context back on any
// failure (a failed create never leaks an activated plugin). The spine
// plugins come from the injected spine suite when the host loaded them from
// the distributed tree (module identity stays single-sourced); without an
// injection the bundled static spine is used.
import { Context, type Fiber } from "@innocenceharness/kernel";
import type { AgentsService, SpawnerService, SpawnerSessionFactory, SubagentLifecyclePort } from "@innocenceharness/harness-agent";
import type { PermissionsService } from "@innocenceharness/harness-permissions";
import type { Provider, ProvidersService } from "@innocenceharness/harness-providers";
import type { SessionService } from "@innocenceharness/harness-session";
import type { SkillsService } from "@innocenceharness/harness-skills";
import type { SystemPromptService } from "@innocenceharness/harness-system-prompt";
import type { ToolsService } from "@innocenceharness/harness-tools";
import type { AgentSessionOptions } from "./session";
import type { Logger, SessionPlugin } from "./registry";
import { adaptHarnessPlugin } from "./session-adapter";
import { SessionRegistryView } from "./session-registry-view";
import {
  assertSpineServices,
  chokepointSession,
  chokepointTools,
  isKernelPlugin,
  resolveRegistryProvider,
} from "./session-mount";
import { staticSpineSuite, type SessionSpineSuite } from "./session-spine";
import { isSessionLoaderPlugin, mountSessionLoader, type SessionLoaderPlugin } from "./session-loader";

// kernel-logger publishes its service without a Context augmentation; the
// session composition declares the typed member (kernel ServiceTable
// contract, same pattern the spine packages use for their services).
declare module "@innocenceharness/kernel" {
  interface Context {
    logger: import("@innocenceharness/kernel-logger").LoggerService;
  }
}

/** Spine services the kernelized session runs on. */
export interface SessionKernelServices {
  tools: ToolsService;
  permissions: PermissionsService;
  providers: ProvidersService;
  skills: SkillsService;
  systemPrompt: SystemPromptService;
  agents: AgentsService;
  session: SessionService;
  spawner: SpawnerService;
}

/** One mounted session kernel: the context, its services and the compat view. */
export interface SessionKernel {
  readonly ctx: Context;
  readonly provider: Provider;
  readonly services: SessionKernelServices;
  readonly view: SessionRegistryView;
  /** Session plugin fibers (native, adapted, and loader owner) in activation order. */
  readonly pluginFibers: readonly Fiber[];
  /** Loader tree entries created in this route scope. */
  readonly loaderEntries: readonly import("@innocenceharness/kernel-loader").LoaderEntry[];
}

/** Inputs of {@link mountSessionKernel} (everything AgentSession.create owns). */
export interface SessionKernelInit {
  sessionId: string;
  plugins: SessionPlugin[];
  /** Loader-backed builtin entries resolved by the host composition. */
  loaderEntries?: SessionLoaderPlugin[];
  /**
   * Injected kernel scope: mounts the session below a host-owned context
   * tree (one route scope below a boot root) instead of a fresh root.
   * Everything the session publishes lands on the scope's own service table
   * (shadowing the host root's names), and session disposal unwinds the
   * scope's fiber.
   */
  scope?: { ctx: Context };
  provider?: Provider;
  providerId?: string;
  workspaceRoot: string;
  systemPrompt?: string;
  permission: AgentSessionOptions["permission"];
  compaction?: AgentSessionOptions["compaction"];
  logger: Logger;
  /**
   * Spine suite the session mounts (see session-spine.ts). Hosts that boot
   * the spine from the distributed tree inject the loaded suite so the
   * session's mounts share those module identities; omitted = the bundled
   * static spine (pre-distribution behavior).
   */
  spine?: SessionSpineSuite;
  /** Recursion seam: the spawner's child-session factory (back into AgentSession). */
  spawnerSessionFactory: SpawnerSessionFactory;
  /** Optional host-neutral child-agent lifecycle sink. */
  lifecycle?: SubagentLifecyclePort;
}

/**
 * Mount order (behavior-preserving; see the task report for the one order
 * deviation forced by providerId resolution):
 *  1. kernel-logger (plugin log prefixing), tools, permissions, providers,
 *     skills, system-prompt, agents — the registration skeleton, asserted
 *     before any host plugin loads;
 *  2. host plugins, sequentially (a failed activation rolls the whole
 *     context back and rethrows): kernel-native plugins (apply) mount
 *     directly on a scope whose tools and session services route through
 *     the view chokepoint; legacy HarnessPlugins (activate) load through
 *     the HarnessPluginAdapter;
 *  3. provider resolution (`options.provider` ?? provider registered by a
 *     plugin), then the session service (ledger + processors + compactor —
 *     queued processors flush here) and the spawner;
 *  4. full skeleton assertion, then the project permission config rules land
 *     on a session-built engine only (an injected engine carries its own).
 */
export async function mountSessionKernel(init: SessionKernelInit): Promise<SessionKernel> {
  // An injected scope hosts the session below the host's context tree; every
  // publication below shadows the host root's names on the scope's own table.
  const ctx = init.scope?.ctx ?? new Context();
  const spine = init.spine ?? staticSpineSuite();
  const log = init.logger;
  // Declared outside the try so the rollback can read what had loaded so far.
  const pluginFibers: Fiber[] = [];
  let loaderEntries: import("@innocenceharness/kernel-loader").LoaderEntry[] = [];
  try {
    await ctx.plugin(spine.logger.LoggerPlugin);
    await ctx.plugin(spine.timer.TimerPlugin);
    await ctx.plugin(spine.hmr.HmrPlugin);
    ctx.logger.addSink(
      (entry) => {
        if (entry.level !== "debug") log(entry.level, entry.message, entry.data);
      },
      { minLevel: "info" },
    );

    await ctx.plugin(spine.tools.ToolsPlugin);
    const permissions = init.permission.engine
      ? spine.permissions.createPermissionsService(init.permission.engine)
      : spine.permissions.createPermissionsService({
          mode: init.permission.mode,
          decider: init.permission.decider,
          workspaceRoot: init.workspaceRoot,
          validateResource: init.permission.validateResource,
          audit: init.permission.audit,
        });
    await ctx.plugin(spine.permissions.createPermissionsPlugin(permissions));
    await ctx.plugin(spine.providers.ProvidersPlugin);
    await ctx.plugin(spine.skills.SkillsPlugin);
    await ctx.plugin(spine.systemPrompt.SystemPromptPlugin);
    await ctx.plugin(spine.agents.AgentsPlugin);
    assertSpineServices(ctx, [
      "logger",
      "tools",
      "permissions",
      "providers",
      "skills",
      "systemPrompt",
      "agents",
    ]);

    const view = new SessionRegistryView(ctx.tools, ctx.providers, ctx.skills, permissions);
    // Native plugins mount directly on this scope: the shadowed tools and
    // session services keep the view chokepoint authoritative for their
    // registrations (the scope shares the root fiber, so the plugin fiber
    // hangs off the session root exactly like an adapter-mounted one).
    const nativeScope = ctx.derive();
    nativeScope.provide("tools", chokepointTools(ctx.tools, view));
    nativeScope.provide("session", chokepointSession(ctx, view));
    const loaderSet = [
      ...(init.loaderEntries ?? []),
      ...init.plugins.filter(isSessionLoaderPlugin),
    ];
    if (loaderSet.length > 0) {
      const mounted = await mountSessionLoader(nativeScope, spine, loaderSet, log);
      pluginFibers.push(mounted.fiber);
      loaderEntries = mounted.entries;
    }
    for (const plugin of init.plugins) {
      if (isSessionLoaderPlugin(plugin)) continue;
      const fiber = isKernelPlugin(plugin)
        ? nativeScope.plugin(plugin)
        : ctx.plugin(adaptHarnessPlugin(plugin, view));
      pluginFibers.push(fiber);
      await fiber;
    }

    const provider = init.provider ?? resolveRegistryProvider(ctx, init.providerId);

    await ctx.plugin(
      spine.session.createSessionPlugin({
        provider,
        sessionId: init.sessionId,
        compaction: init.compaction,
      }),
    );
    view.bindSessionService(ctx.session);
    await ctx.plugin(
      spine.agents.createSpawnerPlugin({
        sessionFactory: init.spawnerSessionFactory,
        provider,
        permission: permissions.engine,
        tools: view.toolsInRegistrationOrder,
        logger: init.logger,
        lifecycle: init.lifecycle,
      }),
    );
    assertSpineServices(ctx, [
      "tools",
      "permissions",
      "providers",
      "skills",
      "session",
      "systemPrompt",
      "spawner",
    ]);

    if (!init.permission.engine && init.permission.projectConfig) {
      permissions.engine.addRules(spine.permissions.rulesFromConfig(init.permission.projectConfig));
    }
    ctx.systemPrompt.setBase(init.systemPrompt ?? "");

    return {
      ctx,
      provider,
      services: {
        tools: ctx.tools,
        permissions,
        providers: ctx.providers,
        skills: ctx.skills,
        systemPrompt: ctx.systemPrompt,
        agents: ctx.agents,
        session: ctx.session,
        spawner: ctx.spawner,
      },
      view,
      pluginFibers,
      loaderEntries,
    };
  } catch (error) {
    // Construction failed after plugins activated: release their resources
    // before surfacing the error, so the failure path never leaks them.
    try {
      await ctx.fiber.dispose();
      for (const fiber of pluginFibers) {
        for (const unwindError of fiber.unwindErrors) {
          log("error", "dispose failed during activation rollback", unwindError);
        }
      }
    } catch (disposeError) {
      log("error", "kernel dispose failed during session create rollback", disposeError);
    }
    throw error;
  }
}

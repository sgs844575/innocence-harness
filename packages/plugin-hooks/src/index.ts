// Hooks plugin (batch 4C, stop face in batch 5): declarative session
// hooks. Task 1 landed the configuration parsing and the bounded command
// runner; this factory composes them into the session — one prompt
// processor plus one tool middleware registered through the spine faces
// (ctx.session / ctx.tools), so hooks fire at session start, on user
// input, and around every tool call, for inherited child sessions too (a
// hook is session-level policy; see wiring.ts). The apply ALSO returns the
// wiring's teardown disposer as its startup result: the kernel fiber
// registers it and runs it while the session unwinds, which is the
// sessionStop execution point — fail-soft, log-only, bounded (wiring.ts).
import type { Context } from "@innocenceharness/kernel";
// The wiring module imports harness-session, harness-tools and
// harness-permissions, which pulls their Context service augmentations
// (ctx.session, ctx.tools, ctx.permissions) into this compilation — the
// same pattern as plugin-memory and plugin-planflow.
import { createHooksWiring, type HooksWiringOptions } from "./wiring";
import { createHookConditionEvaluator } from "./condition";
import type {} from "@innocenceharness/harness-providers";

// Type-only visibility for ctx.logger: kernel-logger ships no Context
// augmentation of its own, so this declares the same member the session
// composition side declares (harness-electron/session-kernel), with an
// identical member type — a legal in-program merge that keeps this
// package free of any host adapter dependency (the plugin-mcp pattern).
declare module "@innocenceharness/kernel" {
  interface Context {
    logger: import("@innocenceharness/kernel-logger").LoggerService;
  }
}

export * from "./config";
export * from "./condition";
export * from "./gate";
export * from "./runner";
export * from "./stop";
export * from "./wording";
export * from "./wiring";

export type HooksPluginOptions = HooksWiringOptions;

export interface HooksPlugin {
  readonly name: "hooks";
  /** Registers the two live faces and returns the sessionStop disposer. */
  apply(ctx: Context): () => Promise<void>;
}

/**
 * Creates the hooks plugin for one session composition: apply registers the
 * processor and the middleware bound to the option getters, so the hooks
 * config and the workspace root resolve per composition without rebuilding,
 * and returns the teardown disposer (the sessionStop face). The returned
 * function travels through the host factory wrapper unchanged (it returns
 * plugin.apply(ctx) verbatim), lands on the plugin fiber as its startup
 * disposer, and fires exactly once when the session's kernel unwinds.
 */
export function createHooksPlugin(options: HooksPluginOptions): HooksPlugin {
  return {
    name: "hooks",
    apply(ctx: Context) {
      // ctx.permissions is read through a getter at gate time (ServiceTable
      // liveness — the member exists only while the permissions fiber is
      // active; the planflow consumption pattern). Absent service means
      // fail-closed skips, not ungated execution. ctx.logger feeds the
      // stop-face log sink the same way (the service outlives this fiber
      // in the unwind order: the logger plugin mounts first, so it
      // disposes last).
      // Providers fiber may be absent in minimal/test contexts; conditional
      // hooks then fail closed in wiring instead of making the hooks plugin fail.
      const providers = ctx.providers;
      const providerId = providers?.ids?.()[0];
      const provider = providerId ? providers.get(providerId) : undefined;
      const { processor, middleware, dispose } = createHooksWiring({
        ...options,
        getPermissions: () => ctx.permissions,
        ...(provider
          ? { conditionEvaluator: createHookConditionEvaluator(provider, () => [...ctx.session.history]) }
          : {}),
        log: (level, message) => ctx.logger.log(level, `[hooks] ${message}`),
      });
      ctx.session.registerProcessor(processor);
      ctx.tools.registerMiddleware(middleware);
      return dispose;
    },
  };
}

// Distribution default (kernel-loader unwrapExports convention): the
// factory, so a disk-loaded module resolves to the single entry point
// hosts configure.
export default createHooksPlugin;

// Hooks plugin (batch 4C): declarative session hooks. Task 1 landed the
// configuration parsing and the bounded command runner; this factory composes
// them into the session — one prompt processor plus one tool middleware
// registered through the spine faces (ctx.session / ctx.tools), so hooks fire
// at session start, on user input, and around every tool call, for inherited
// child sessions too (a hook is session-level policy; see wiring.ts).
import type { Context } from "@innocenceharness/kernel";
// The wiring module imports harness-session and harness-tools, which pulls
// their Context service augmentations (ctx.session, ctx.tools) into this
// compilation — the same pattern as plugin-memory.
import { createHooksWiring, type HooksWiringOptions } from "./wiring";

export * from "./config";
export * from "./runner";
export * from "./wording";
export * from "./wiring";

export type HooksPluginOptions = HooksWiringOptions;

export interface HooksPlugin {
  readonly name: "hooks";
  apply(ctx: Context): void;
}

/**
 * Creates the hooks plugin for one session composition: apply registers the
 * processor and the middleware bound to the option getters, so the hooks
 * config and the workspace root resolve per composition without rebuilding.
 */
export function createHooksPlugin(options: HooksPluginOptions): HooksPlugin {
  return {
    name: "hooks",
    apply(ctx: Context) {
      const { processor, middleware } = createHooksWiring(options);
      ctx.session.registerProcessor(processor);
      ctx.tools.registerMiddleware(middleware);
    },
  };
}

// Distribution default (kernel-loader unwrapExports convention): the
// factory, so a disk-loaded module resolves to the single entry point
// hosts configure.
export default createHooksPlugin;

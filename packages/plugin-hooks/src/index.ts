// Hooks plugin (batch 4C task 1): factory skeleton for declarative session
// hooks. This task lands the configuration parsing and the bounded command
// runner; the prompt/tool/session-start wiring arrives with the next task,
// so apply is a harmless placeholder.
import type { Context } from "@innocenceharness/kernel";

export * from "./config";
export * from "./runner";

export interface HooksPluginOptions {
  /** Reads the raw "hooks" configuration (unknown shape) per composition. */
  getHooksConfig: () => Promise<unknown>;
}

export interface HooksPlugin {
  readonly name: "hooks";
  apply(ctx: Context): void;
}

/** Creates the hooks plugin for one session; the wiring lands with task 2. */
export function createHooksPlugin(_options: HooksPluginOptions): HooksPlugin {
  return {
    name: "hooks",
    apply(_ctx: Context) {
      // Intentionally empty: processor and middleware registration
      // surfaces arrive with the wiring task.
    },
  };
}

// Distribution default (kernel-loader unwrapExports convention): the
// factory, so a disk-loaded module resolves to the single entry point
// hosts configure.
export default createHooksPlugin;

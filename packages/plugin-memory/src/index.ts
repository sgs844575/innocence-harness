// Memory plugin (batch 4B): a dual-root durable-note store with the
// write/list/read tool trio (task 1) plus the first-turn index injection
// processor (task 2). Factory form (same staged shape as the creation
// and reminders plugins) so the host session composition supplies the two
// roots — the user data root and the workspace .innocence root — instead of
// this package importing host paths; tests pass tmp directories.
import type { Context } from "@innocenceharness/kernel";
// The tools module imports harness-tools, which also pulls its Context
// service augmentation (ctx.tools) into this compilation. The type-only
// import below likewise pulls the harness-session augmentation (ctx.session)
// that apply needs for the injection processor registration.
import type {} from "@innocenceharness/harness-session";
import { createMemoryTools, type MemoryToolsOptions } from "./tools";
import { createMemoryIndexProcessor } from "./indexInjection";

export * from "./store";
export * from "./tools";
export * from "./indexInjection";

export type MemoryPluginOptions = MemoryToolsOptions;

export interface MemoryPlugin {
  readonly name: "memory";
  apply(ctx: Context): void;
}

/** Creates the memory plugin for one session: registers the three tools and
 *  the "memory-index" processor bound to the option getters (roots resolve
 *  per call, so a workspace switch between sessions is honored without
 *  rebuilding the plugin). */
export function createMemoryPlugin(options: MemoryPluginOptions): MemoryPlugin {
  return {
    name: "memory",
    apply(ctx: Context) {
      for (const tool of createMemoryTools(options)) ctx.tools.register(tool);
      ctx.session.registerProcessor(createMemoryIndexProcessor(options));
    },
  };
}

// Distribution default (kernel-loader unwrapExports convention): the factory,
// so a disk-loaded module resolves to the single entry point hosts configure.
export default createMemoryPlugin;

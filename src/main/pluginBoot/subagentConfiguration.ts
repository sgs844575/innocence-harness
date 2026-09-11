import path from "node:path";
import type { Context, ObjectPlugin } from "@innocenceharness/kernel";
import type { BundleAgent } from "@innocenceharness/harness-plugin-catalog";

interface ScopedPlugin extends ObjectPlugin {
  createScoped?: (userRoot: string, projectRoot?: string, contributions?: readonly BundleAgent[]) => Promise<ObjectPlugin>;
}

/** Resolve the capability through the staged loader and inject host-owned roots. */
export function configuredSubagentPlugin(load: () => Promise<unknown>, userRoot: () => string, workspaceRoot: string, contributions: readonly BundleAgent[] = []) {
  return {
    name: "scoped-subagent",
    async apply(ctx: Context) {
      const loaded = await load() as ScopedPlugin;
      if (!loaded.createScoped) {
        if (!loaded.apply) throw new Error("Invalid subagent plugin.");
        return loaded.apply(ctx);
      }
      const roots = [userRoot(), workspaceRoot ? path.join(workspaceRoot, ".innocence") : undefined] as const;
      const scoped = contributions.length ? await loaded.createScoped(...roots, contributions) : await loaded.createScoped(...roots);
      return scoped.apply(ctx);
    },
  };
}

// Route-session loader bridge: keeps resolved plugin rows inside the loader
// tree while preserving the session registry chokepoints for native plugins.
import type { Context, ObjectPlugin } from "@innocenceharness/kernel";
import type { EntryOptions, LoaderEntry, ModuleResolver } from "@innocenceharness/kernel-loader";
import type { Logger } from "./registry";
import type { SessionSpineSuite } from "./session-spine";

export interface SessionModuleResolver extends ModuleResolver {}

export interface SessionLoaderPlugin {
  readonly name?: string;
  readonly options: EntryOptions;
  /** Resolver shared from the boot root when this entry imports normally. */
  readonly resolver?: SessionModuleResolver;
  /** Optional configured factory result. When absent, loader.create imports normally. */
  readonly plugin?: ObjectPlugin;
  /** Core entry failures abort construction; optional entries are isolated. */
  readonly core: boolean;
  /** Group entries are transactional: route construction must observe failures. */
  readonly abortOnFailure?: boolean;
}


/** Whether a session plugin is a resolved loader row rather than a legacy plugin. */
export function isSessionLoaderPlugin(value: unknown): value is SessionLoaderPlugin {
  return (
    typeof value === "object" &&
    value !== null &&
    "options" in value &&
    "core" in value &&
    "resolver" in value
  );
}

/** Mount loader rows under the route-local native scope, preserving ctx.entry. */
export async function mountSessionLoader(
  nativeScope: Context,
  spine: SessionSpineSuite,
  plugins: readonly SessionLoaderPlugin[],
  log: Logger,
): Promise<{ fiber: ReturnType<Context["plugin"]>; entries: LoaderEntry[] }> {
  const fiber = nativeScope.plugin(spine.loader.Loader);
  await fiber;
  const loader = fiber.ctx.loader;
  loader.builtins.group = {
    name: "group",
    apply(ctx) {
      const config = ctx.entry?.options.config;
      if (!config || typeof config !== "object" || !Array.isArray((config as { entries?: unknown }).entries)) {
        throw new Error("loader group entry has invalid config");
      }
      return spine.group.createGroupPlugin(
        config as Parameters<typeof spine.group.createGroupPlugin>[0],
      ).apply(ctx);
    },
  };
  const resolver = plugins.find((entry) => entry.resolver)?.resolver;
  if (resolver) loader.internal = resolver;
  const entries: LoaderEntry[] = [];
  for (const loaderEntry of plugins) {
    try {
      const entry = loaderEntry.plugin
        ? await loader.createResolved(loaderEntry.options, loaderEntry.plugin)
        : await loader.create(loaderEntry.options);
      entries.push(entry);
    } catch (error) {
      if (loaderEntry.core || loaderEntry.abortOnFailure) throw error;
      log("warn", `session loader entry "${loaderEntry.options.id}" failed; isolated`, {
        error: String(error),
      });
      const failed = [...loader.entries()].find((entry) => entry.options.id === loaderEntry.options.id);
      if (failed) entries.push(failed);
    }
  }
  return { fiber, entries };
}

import type { Context, Plugin } from "@innocenceharness/kernel";
import type { EntryCreateOptions } from "@innocenceharness/kernel-loader";

export interface GroupEntry extends Omit<EntryCreateOptions, "id" | "name"> {
  id: string;
  name?: string;
  /** Optional host-resolved plugin; loader ownership remains transactional. */
  plugin?: Plugin;
}

export interface GroupOptions {
  id: string;
  entries: GroupEntry[];
}

export interface GroupPlugin {
  name: string;
  apply(ctx: Context): Promise<void>;
}

/** Creates a loader-backed group whose entries are started transactionally. */
export function createGroupPlugin(options: GroupOptions): GroupPlugin {
  return {
    name: `group:${options.id}`,
    async apply(ctx) {
      const owner = ctx.entry;
      if (!owner) throw new Error(`group ${options.id} must be mounted through the loader`);
      const loader = ctx.loader;
      try {
        for (const { id, name, config, disabled, plugin } of options.entries) {
          if (plugin) {
            await loader.createResolved({ id, name: name ?? id, config, disabled }, plugin, owner);
          } else {
            await loader.create({ id, name: name ?? id, config, disabled }, owner);
          }
        }
      } catch (error) {
        await Promise.allSettled(
          [...(owner.subtree?.entries() ?? [])].map((entry) => entry.fiber?.dispose()),
        );
        throw error;
      }
    },
  };
}

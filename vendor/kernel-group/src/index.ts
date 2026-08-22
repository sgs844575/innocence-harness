import type { Context } from "@innocencecode/kernel";
import type { EntryCreateOptions, LoaderEntry } from "@innocencecode/kernel-loader";

export interface GroupEntry extends EntryCreateOptions {
  id: string;
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
      const loader = ctx.loader;
      const mounted: LoaderEntry[] = [];
      try {
        for (const entry of options.entries) {
          mounted.push(await loader.create(entry));
        }
      } catch (error) {
        await Promise.allSettled(mounted.map((entry) => entry.fiber?.dispose()));
        throw error;
      }
    },
  };
}

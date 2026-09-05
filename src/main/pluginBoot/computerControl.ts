import type { EntryOptions } from "@innocenceharness/kernel-loader";
import type { HarnessSettings } from "@innocenceharness/harness-electron";
import type { Context, ObjectPlugin } from "@innocenceharness/kernel";
import type { ToolActivityObserver } from "@innocenceharness/harness-tools";

export function computerAccessFor(settings?: HarnessSettings, live?: () => boolean): () => boolean {
  return () => settings?.computerEnabled !== false && settings?.pluginToggles?.computer !== false && (live?.() ?? true);
}

/** Apply the host switch after project resolution so project config cannot reopen access. */
export function configureComputerEntry(entry: EntryOptions, isEnabled: () => boolean): EntryOptions {
  if (![entry.id, entry.name].some((id) => id === "computer" || id === "kernel:computer")) return entry;
  return {
    ...entry,
    disabled: entry.disabled || !isEnabled(),
  };
}

/** Bind a host port to the dynamically imported plugin; loader config is metadata. */
export function configuredComputerPlugin(importPlugin: () => Promise<unknown>, isEnabled: () => boolean, activity?: ToolActivityObserver): ObjectPlugin {
  return {
    name: "computer-access",
    async apply(ctx) {
      const plugin = await importPlugin() as { apply(ctx: Context, options: { isEnabled: () => boolean; activity?: ToolActivityObserver }): ReturnType<ObjectPlugin["apply"]> };
      if (!plugin || typeof plugin.apply !== "function") throw new Error("Computer plugin has no activation entry point.");
      return plugin.apply(ctx, { isEnabled, ...(activity ? { activity } : {}) });
    },
  };
}

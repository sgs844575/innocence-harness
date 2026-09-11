import type { PluginInventoryEntry } from "../../../../../shared/ipc";
import type { InstalledPlugin } from "../../../../../shared/pluginCatalogIpc";
import type { Translate } from "./styles";
export function pluginComponentLabel(value: string, t: Translate): string {
  const key = `settings.plugins.component.${value}`;
  const label = t(key);
  return label === key ? value : label;
}
export function pluginPresentation(entry: PluginInventoryEntry, installed: InstalledPlugin | undefined, t: Translate): { title: string; description: string } {
  if (installed) return { title: installed.title, description: installed.description };
  const key = `settings.plugins.builtin.${entry.id}`;
  const title = t(key);
  const description = t(`${key}.desc`);
  return { title: title === key ? entry.title : title, description: description === `${key}.desc` ? entry.id : description };
}

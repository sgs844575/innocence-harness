import { useState } from "react";
import { ChevronDown, Puzzle } from "lucide-react";
import type { PluginInventoryEntry } from "../../../../../shared/ipc";
import type { InstalledPlugin, RepositorySource } from "../../../../../shared/pluginCatalogIpc";
import { Switch } from "../../ui/Switch";
import { actionClass, type Translate } from "./styles";
import { pluginPresentation, pluginComponentLabel } from "./pluginPresentation";

export function PluginRow({ entry, installed, t, busy, onToggle, onUpdate, onRemove }: {
  entry: PluginInventoryEntry; installed?: InstalledPlugin; t: Translate; busy: boolean;
  onToggle(enabled: boolean): void; onUpdate(source: RepositorySource): void; onRemove(): void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const label = (key: string) => t(`settings.plugins.${key}`);
  const { title, description } = pluginPresentation(entry, installed, t);
  return <li>
    <div className="flex items-center gap-3 px-4 py-4">
      <Puzzle size={20} strokeWidth={1.4} className="shrink-0 text-(--color-muted)" />
      <button aria-expanded={open} className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-(--color-accent)" onClick={() => setOpen(!open)}>
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-(--color-foreground-strong)">{title}</span><span className="text-[12px] text-(--color-faint)">{installed?.version}</span>{entry.core && <span className="rounded border border-(--color-border) px-1 text-[12px] text-(--color-muted)">{label("required")}</span>}</div>
        <p className="mt-1 line-clamp-2 text-[12px] text-(--color-muted)">{description}</p>
      </button>
      <span className="hidden text-[12px] text-(--color-muted) sm:inline">{label(`state.${entry.state}`)}</span>
      <Switch tone="neutral" checked={entry.state === "active"} disabled={busy || !entry.toggleable || entry.via === "project"} label={`${label("enabled")} ${title}`} onChange={onToggle} />
      <button className="rounded p-1 text-(--color-muted) hover:bg-(--color-hover)" aria-label={`${label("details")} ${title}`} aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown size={15} className={open ? "rotate-180" : ""} /></button>
    </div>
    {open && <div className="space-y-3 border-t border-(--color-hairline) px-4 py-4 text-[12px]">
      {entry.via === "project" && <p className="text-(--color-tool-warn)">{label("projectOverride")}</p>}
      {installed ? <>
        <p className="break-all font-mono text-(--color-muted)">{installed.source.url}<br />{installed.source.path} · {installed.commit.slice(0, 12)}</p>
        <p>{label("included")}: {installed.components.map((key) => label(`component.${key}`)).join("、")}</p>
        {!!installed.unsupported.length && <p className="text-(--color-tool-warn)">{label("unsupported")}: {installed.unsupported.map((key) => pluginComponentLabel(key, t)).join("、")}</p>}
        <div className="flex flex-wrap items-center gap-2"><button className={actionClass} disabled={busy} onClick={() => onUpdate(installed.source)}>{label("checkUpdate")}</button>
          {confirming ? <><span>{label("removeHint")}</span><button className={actionClass} disabled={busy} onClick={onRemove}>{label("confirmRemove")}</button><button className={actionClass} disabled={busy} onClick={() => setConfirming(false)}>{label("cancel")}</button></> : <button className={actionClass} disabled={busy} onClick={() => setConfirming(true)}>{label("uninstall")}</button>}
        </div>
      </> : <p className="text-(--color-muted)">{label("unmanaged")}</p>}
    </div>}
  </li>;
}

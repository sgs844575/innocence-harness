import { useEffect, useRef, useState } from "react";
import { Bot, Folder, Monitor, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type { CatalogPreset, SavedPreset, SubagentSettingsApi } from "../../../../shared/subagentIpc";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { SubagentEditor } from "./SubagentEditor";

const buttonClass = "rounded-lg border border-(--color-border) p-1.5 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent) disabled:opacity-45";
const empty: SavedPreset = { id: "", title: "", description: "", systemPrompt: "", tools: "all", enabled: true };
export function SubagentsPanel({ api, t }: { api?: SubagentSettingsApi; t: (key: string) => string }): React.JSX.Element {
  const [target, setTarget] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<{ root: string; name: string }[]>([]);
  const [rows, setRows] = useState<CatalogPreset[]>([]);
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<{ preset: SavedPreset; create: boolean; readOnly: boolean } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const lock = useRef(false);
  const label = (key: string) => t(`settings.subagents.${key}`);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(""); setRows([]);
    if (!api) { setLoading(false); return; }
    void Promise.all([api.subagentWorkspaces(), api.subagentCatalog(target)]).then(([spaces, presets]) => {
      if (current) { setWorkspaces(spaces); setRows(presets); }
    }).catch((cause) => { if (current) setError(String(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, target, tick]);
  const mutate = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); setTick((n) => n + 1); setDeleting(null); }
    catch (cause) { setError(String(cause)); }
    finally { lock.current = false; setBusy(false); }
  };
  const editable = (row: CatalogPreset) => row.source === (target === null ? "global" : "project");
  const visible = rows.filter((row) => `${row.id} ${row.title} ${row.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="mx-auto w-full max-w-[832px]" data-testid="subagent-settings">
    <h1 className="mb-7 text-[28px] font-bold text-(--color-foreground-strong)">{t("settings.section.subagents")}</h1>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Select pill disabled={busy} ariaLabel={label("scope")} value={target ?? "__global__"} options={[{ value: "__global__", label: label("global"), icon: <Monitor size={15} /> }, ...workspaces.map((space) => ({ value: space.root, label: space.name, icon: <Folder size={15} /> }))]} onChange={(value) => { setTarget(value === "__global__" ? null : value); setEditor(null); setDeleting(null); }} />
      <span className="border-l border-(--color-border) pl-3 text-(--color-muted)">{label("count").replace("{count}", String(rows.length))}</span>
      <label className="ml-auto flex h-9 w-64 max-w-full items-center gap-2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) px-3 focus-within:border-(--color-accent)"><Search size={15} className="text-(--color-muted)" /><input type="search" aria-label={label("search")} placeholder={label("search")} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--color-faint)" /></label>
    </div>
    <p className="mb-5 text-[12px] text-(--color-muted)">{label(target === null ? "globalHint" : "projectHint")} {label("applyHint")}</p>
    <div className="mb-4 flex items-center justify-between"><h2>{label("installed")}</h2><div className="flex gap-2"><button className={buttonClass} disabled={!api || loading || busy} aria-label={label("refresh")} onClick={() => setTick((n) => n + 1)}><RefreshCw size={15} /></button><button disabled={!api || loading || busy} className="flex items-center gap-1 rounded-lg bg-(--color-brand) px-3 py-1 text-(--color-inverse) disabled:opacity-45" onClick={() => setEditor({ preset: { ...empty }, create: true, readOnly: false })}><Plus size={15} />{label("create")}</button></div></div>
    {error && <p role="alert" className="mb-4 text-(--color-tool-err)">{error}</p>}
    <ul aria-busy={loading || busy} className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">
      {visible.map((row) => <li key={row.id} className="flex items-center gap-3 px-4 py-4">
        <Bot size={20} strokeWidth={1.4} className="shrink-0 text-(--color-muted)" />
        <button disabled={busy} onClick={() => setEditor({ preset: row, create: false, readOnly: !editable(row) })} className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-(--color-accent)"><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-(--color-foreground-strong)">{row.title}</span><span className="text-[12px] text-(--color-faint)">{row.id}</span><span className="rounded border border-(--color-border) px-1 text-[12px] text-(--color-muted)">{label(row.source)}</span><span className="text-[12px] text-(--color-muted)">{label(row.tools)}</span></div><p className="mt-1 line-clamp-2 text-[12px] text-(--color-muted)">{row.description}</p></button>
        <Switch tone="neutral" checked={row.enabled} disabled={!editable(row) || busy} label={`${label("enabled")} ${row.title}`} onChange={(enabled) => void mutate(() => api!.subagentSave(target, { ...row, enabled }, false))} />
        {editable(row) && (deleting === row.id ? <div className="flex gap-2"><button disabled={busy} className={buttonClass} onClick={() => void mutate(() => api!.subagentRemove(target, row.id))}>{label("confirmDelete")}</button><button disabled={busy} className={buttonClass} onClick={() => setDeleting(null)}>{label("cancel")}</button></div> : <button disabled={busy} className={buttonClass} aria-label={`${label("delete")} ${row.title}`} onClick={() => setDeleting(row.id)}><Trash2 size={14} /></button>)}
      </li>)}
    </ul>
    {!visible.length && <p role="status" className="py-12 text-center text-(--color-muted)">{label(!api ? "unavailable" : loading ? "loading" : "empty")}</p>}
    {editor && api && <SubagentEditor {...editor} t={t} onClose={() => setEditor(null)} onSave={async (preset) => { await api.subagentSave(target, preset, editor.create); setTick((n) => n + 1); }} />}
  </div>;
}

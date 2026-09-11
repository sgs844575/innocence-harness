import { useEffect, useRef, useState } from "react";
import { Folder, Monitor, MoreHorizontal, Plus, RefreshCw, Search, Trash2, WandSparkles } from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { SkillSettingsApi, ManagedSkill } from "../../../../shared/skillSettingsIpc";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { AvailableSkills } from "./AvailableSkills";
import { SkillImportDialog } from "./SkillsDialogs";

export type SkillsApi = SkillSettingsApi & { listSkills?(root: string): Promise<{ name: string; description: string }[]>; subagentWorkspaces(): Promise<{ root: string; name: string }[]> };
export const skillButton = "rounded-lg border border-(--color-border) p-1.5 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent) disabled:opacity-45";
export function SkillsPanel({ api, t, onCreate }: { api?: SkillsApi; t: (key: string) => string; onCreate?: (target: string | null) => Promise<void> }): React.JSX.Element {
  const [target, setTarget] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<{ root: string; name: string }[]>([]);
  const [rows, setRows] = useState<ManagedSkill[]>([]);
  const [provided, setProvided] = useState<{ name: string; description: string }[]>([]);
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"import" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const lock = useRef(false);
  const label = (key: string) => t(`settings.skills.${key}`);
  useEffect(() => {
    let current = true;
    setRows([]); setProvided([]); setLoading(true); setError("");
    if (!api) { setLoading(false); return; }
    void Promise.all([api.subagentWorkspaces(), api.skillSettingsList(target), api.listSkills?.(target ?? "") ?? Promise.resolve([])]).then(([workspaces, skills, catalog]) => {
      if (current) { setSpaces(workspaces); setRows(skills); setProvided(catalog.filter((s) => !skills.some((row) => row.name === s.name))); }
    }).catch((e) => { if (current) setError(String(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, target, tick]);
  const mutate = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); setTick((n) => n + 1); setDeleting(null); }
    catch (e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const visible = rows.filter((s) => `${s.name} ${s.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="mx-auto w-full max-w-[832px]" data-testid="skills-settings">
    <h1 className="mb-7 text-[28px] font-bold text-(--color-foreground-strong)">{t("settings.section.skills")}</h1>
    <div className="mb-7 flex flex-wrap items-center gap-3">
      <Select pill disabled={busy} ariaLabel={label("scope")} value={target ?? "__global__"} options={[{ value: "__global__", label: label("global"), icon: <Monitor size={15} /> }, ...spaces.map((s) => ({ value: s.root, label: s.name, icon: <Folder size={15} /> }))]} onChange={(value) => { setTarget(value === "__global__" ? null : value); setDeleting(null); }} />
      <span className="border-l border-(--color-border) pl-3">{t("settings.section.skills")} <span className="text-(--color-muted)">{rows.length + provided.length}</span></span>
      <label className="ml-auto flex h-9 w-64 items-center gap-2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) px-3 focus-within:border-(--color-accent)"><Search size={15} className="text-(--color-muted)" /><input type="search" aria-label={label("search")} placeholder={label("search")} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--color-faint)" /></label>
    </div>
    <div className="mb-4 flex items-center justify-between"><h2>{label("installed")} <span className="text-(--color-muted)">{rows.length}</span></h2><div className="flex gap-2">
      <Dropdown.Root><Dropdown.Trigger disabled={!api || busy} aria-label={label("more")} className={skillButton}><MoreHorizontal size={15} /></Dropdown.Trigger><Dropdown.Portal><Dropdown.Content align="end" sideOffset={6} className="dropdown-in z-50 min-w-32 rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1 shadow-(--shadow-pop)"><Dropdown.Item onSelect={() => setDialog("import")} className="rounded-lg px-3 py-2 outline-none data-highlighted:bg-(--color-hover)">{label("import")}</Dropdown.Item></Dropdown.Content></Dropdown.Portal></Dropdown.Root>
      <button disabled={!api || loading || busy} className={skillButton} aria-label={label("refresh")} onClick={() => setTick((n) => n + 1)}><RefreshCw size={15} /></button>
      <button disabled={!onCreate || !api || busy} onClick={() => void mutate(() => onCreate!(target))} className="flex items-center gap-1 rounded-lg bg-(--color-brand) px-3 py-1 text-(--color-inverse) disabled:opacity-45"><Plus size={15} />{label("create")}</button>
    </div>
    </div>
    {error && <p role="alert" className="mb-4 text-(--color-tool-err)">{error}</p>}
    <ul aria-busy={loading || busy} className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">{visible.map((row) => <li key={row.id} className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-pop) bg-(--color-background)"><WandSparkles size={18} strokeWidth={1.4} className="text-(--color-muted)" /></span>
      <div className="min-w-0 flex-1"><p className="truncate text-(--color-foreground-strong)">{row.name}</p><p title={row.description} className="mt-1 truncate text-[12px] text-(--color-muted)">{row.description}</p></div>
      <Switch tone="neutral" checked={row.enabled} disabled={busy} label={`${label("enabled")} ${row.name}`} onChange={(enabled) => void mutate(() => api!.skillSettingsEnable(target, row.id, enabled))} />
      {deleting === row.id ? <div className="flex gap-2"><button disabled={busy} className={skillButton} onClick={() => void mutate(() => api!.skillSettingsRemove(target, row.id))}>{label("confirm")}</button><button disabled={busy} className={skillButton} onClick={() => setDeleting(null)}>{label("cancel")}</button></div> : <button disabled={busy} aria-label={`${label("delete")} ${row.name}`} className="rounded p-1 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent)" onClick={() => setDeleting(row.id)}><Trash2 size={14} /></button>}
    </li>)}</ul>
    {!visible.length && <p role="status" className="py-12 text-center text-(--color-muted)">{label(!api ? "unavailable" : loading ? "loading" : "empty")}</p>}
    {provided.length > 0 && <AvailableSkills key={`${target}:${query}:${tick}`} skills={provided} query={query} label={label} />}
    <p className="mt-4 text-[12px] text-(--color-muted)">{label("hint")}</p>
    {dialog === "import" && api && <SkillImportDialog api={api} target={target} spaces={spaces} label={label} onClose={() => { setDialog(null); setTick((n) => n + 1); }} />}
  </div>;
}

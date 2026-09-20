import { useEffect, useRef, useState } from "react";
import { Anchor, Folder, Monitor, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type { HookListEntry, HookPluginGroup, HookSettingsApi } from "../../../../shared/hookSettingsIpc";
import { Select } from "../ui/Select";
import { HookCreateDialog } from "./HooksDialogs";

export type HooksApi = HookSettingsApi & { subagentWorkspaces(): Promise<{ root: string; name: string }[]> };
const hookButton = "rounded-lg border border-(--color-border) p-1.5 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent) disabled:opacity-45";

function matches(query: string, row: { event: string; command: string }): boolean {
  return `${row.event} ${row.command}`.toLocaleLowerCase().includes(query);
}

/** 分组展示名：与插件清单/命令分组同一约定（内置插件本地化标题键优先，缺省回落清单 title）。 */
function groupTitle(group: HookPluginGroup, t: (key: string) => string): string {
  const key = `settings.plugins.builtin.${group.id}`;
  const localized = t(key);
  return localized === key ? group.title : localized;
}

function rowDetails(row: HookListEntry, label: (key: string) => string): string {
  return [
    row.match ? `${label("fieldMatch")}: ${row.match}` : "",
    row.timeoutMs !== undefined ? `${row.timeoutMs}ms` : "",
    row.condition ? `${label("fieldCondition")}: ${row.condition}` : "",
  ].filter(Boolean).join(" · ");
}

export function HooksPanel({ api, t }: { api?: HooksApi; t: (key: string) => string }): React.JSX.Element {
  const [target, setTarget] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<{ root: string; name: string }[]>([]);
  const [rows, setRows] = useState<HookListEntry[]>([]);
  const [groups, setGroups] = useState<HookPluginGroup[]>([]);
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const lock = useRef(false);
  const label = (key: string) => t(`settings.hooks.${key}`);
  useEffect(() => {
    let current = true;
    setRows([]); setGroups([]); setLoading(true); setError("");
    if (!api) { setLoading(false); return; }
    void Promise.all([api.subagentWorkspaces(), api.hookSettingsList(target)]).then(([workspaces, result]) => {
      if (current) { setSpaces(workspaces); setRows(result.installed); setGroups(result.plugins); }
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
  const needle = query.trim().toLocaleLowerCase();
  const visible = rows.filter((row) => matches(needle, row));
  const visibleGroups = groups
    .map((group) => ({ ...group, hooks: group.hooks.filter((hook) => matches(needle, hook) || groupTitle(group, t).toLocaleLowerCase().includes(needle)) }))
    .filter((group) => group.hooks.length > 0);
  const total = rows.length + groups.reduce((sum, group) => sum + group.hooks.length, 0);
  return <div className="mx-auto w-full max-w-[832px]" data-testid="hooks-settings">
    <h1 className="mb-7 text-[28px] font-bold text-(--color-foreground-strong)">{t("settings.section.hooks")}</h1>
    <div className="mb-7 flex flex-wrap items-center gap-3">
      <Select pill disabled={busy} ariaLabel={label("scope")} value={target ?? "__global__"} options={[{ value: "__global__", label: label("global"), icon: <Monitor size={15} /> }, ...spaces.map((s) => ({ value: s.root, label: s.name, icon: <Folder size={15} /> }))]} onChange={(value) => { setTarget(value === "__global__" ? null : value); setDeleting(null); }} />
      <span className="border-l border-(--color-border) pl-3">{t("settings.section.hooks")} <span className="text-(--color-muted)">{total}</span></span>
      <label className="ml-auto flex h-9 w-64 items-center gap-2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) px-3 focus-within:border-(--color-accent)"><Search size={15} className="text-(--color-muted)" /><input type="search" aria-label={label("search")} placeholder={label("search")} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--color-faint)" /></label>
    </div>
    <div className="mb-4 flex items-center justify-between"><h2>{label("installed")} <span className="text-(--color-muted)">{rows.length}</span></h2><div className="flex gap-2">
      <button disabled={!api || loading || busy} className={hookButton} aria-label={label("refresh")} onClick={() => setTick((n) => n + 1)}><RefreshCw size={15} /></button>
      <button disabled={!api || busy} onClick={() => setCreating(true)} className="flex items-center gap-1 rounded-lg bg-(--color-brand) px-3 py-1 text-(--color-inverse) disabled:opacity-45"><Plus size={15} />{label("create")}</button>
    </div>
    </div>
    <p className="mb-4 text-[12px] text-(--color-muted)">{label("overrideNote")}</p>
    {error && <p role="alert" className="mb-4 text-(--color-tool-err)">{error}</p>}
    {visible.length > 0 && <ul aria-busy={loading || busy} className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">{visible.map((row) => <li key={row.index} className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-pop) bg-(--color-background)"><Anchor size={18} strokeWidth={1.4} className="text-(--color-muted)" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-(--color-foreground-strong)">{row.event || "—"}{!row.valid && <span title={row.warning} className="ml-2 font-sans text-[12px] text-(--color-tool-warn)">{label("invalidEntry")}</span>}</p>
        <p title={row.command} className="mt-1 truncate font-mono text-[12px] text-(--color-muted)">{row.command}</p>
        {rowDetails(row, label) && <p className="mt-0.5 truncate text-[12px] text-(--color-faint)">{rowDetails(row, label)}</p>}
      </div>
      {deleting === row.index ? <div className="flex gap-2"><button disabled={busy} className={hookButton} onClick={() => void mutate(() => api!.hookSettingsRemove(target, row.index))}>{label("confirm")}</button><button disabled={busy} className={hookButton} onClick={() => setDeleting(null)}>{label("cancel")}</button></div> : <button disabled={busy} aria-label={`${label("delete")} ${row.event} #${row.index}`} className="rounded p-1 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent)" onClick={() => setDeleting(row.index)}><Trash2 size={14} /></button>}
    </li>)}</ul>}
    {!visible.length && api && !loading && rows.length === 0 && !needle
      ? <div className="rounded-(--radius-pop) border border-dashed border-(--color-border) px-4 py-12 text-center">
        <p className="text-(--color-foreground-strong)">{label("empty")}</p>
        <p className="mt-1 text-[12px] text-(--color-muted)">{label("emptyHint")}</p>
        <button disabled={busy} onClick={() => setCreating(true)} className="mx-auto mt-4 flex items-center gap-1 rounded-lg bg-(--color-brand) px-3 py-1.5 text-(--color-inverse) disabled:opacity-45"><Plus size={15} />{label("create")}</button>
      </div>
      : !visible.length && <p role="status" className="py-12 text-center text-(--color-muted)">{label(!api ? "unavailable" : loading ? "loading" : "noMatch")}</p>}
    {visibleGroups.map((group) => <section key={group.id} className="mt-7" aria-label={groupTitle(group, t)}>
      <h2 className="mb-4">{groupTitle(group, t)} <span className="text-(--color-muted)">{group.hooks.length}</span></h2>
      <ul className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">{group.hooks.map((hook, index) => <li key={`${hook.event}-${index}`} className="flex items-center gap-3 px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-pop) bg-(--color-background)"><Anchor size={18} strokeWidth={1.4} className="text-(--color-muted)" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-(--color-foreground-strong)">{hook.event}</p>
          <p title={hook.command} className="mt-1 truncate font-mono text-[12px] text-(--color-muted)">{hook.command}</p>
        </div>
      </li>)}</ul>
    </section>)}
    <p className="mt-4 text-[12px] text-(--color-muted)">{label("hint")}</p>
    {creating && api && <HookCreateDialog label={label} onSubmit={async (hook) => { await api.hookSettingsCreate(target, hook); setTick((n) => n + 1); }} onClose={() => setCreating(false)} />}
  </div>;
}

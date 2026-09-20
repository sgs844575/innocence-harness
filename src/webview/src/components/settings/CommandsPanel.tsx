import { useEffect, useRef, useState } from "react";
import { Folder, Monitor, MoreHorizontal, Plus, RefreshCw, Search, SquareSlash, Trash2 } from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { CommandPluginGroup, CommandSettingsApi, ManagedCommand } from "../../../../shared/commandSettingsIpc";
import { Select } from "../ui/Select";
import { CommandCreateDialog, CommandImportDialog } from "./CommandsDialogs";

export type CommandsApi = CommandSettingsApi & { subagentWorkspaces(): Promise<{ root: string; name: string }[]> };
export const commandButton = "rounded-lg border border-(--color-border) p-1.5 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent) disabled:opacity-45";

function matches(query: string, row: { name: string; description: string }): boolean {
  return `${row.name} ${row.description}`.toLocaleLowerCase().includes(query);
}

/** 分组展示名：与插件清单一侧的展示约定一致（内置插件的本地化标题键优先，缺省回落清单 title）。 */
function groupTitle(group: CommandPluginGroup, t: (key: string) => string): string {
  const key = `settings.plugins.builtin.${group.id}`;
  const localized = t(key);
  return localized === key ? group.title : localized;
}

export function CommandsPanel({ api, t }: { api?: CommandsApi; t: (key: string) => string }): React.JSX.Element {
  const [target, setTarget] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<{ root: string; name: string }[]>([]);
  const [rows, setRows] = useState<ManagedCommand[]>([]);
  const [groups, setGroups] = useState<CommandPluginGroup[]>([]);
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"import" | "create" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const lock = useRef(false);
  const label = (key: string) => t(`settings.commands.${key}`);
  useEffect(() => {
    let current = true;
    setRows([]); setGroups([]); setLoading(true); setError("");
    if (!api) { setLoading(false); return; }
    void Promise.all([api.subagentWorkspaces(), api.commandSettingsList(target)]).then(([workspaces, result]) => {
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
    .map((group) => ({ ...group, commands: group.commands.filter((command) => matches(needle, command)) }))
    .filter((group) => group.commands.length > 0);
  const total = rows.length + groups.reduce((sum, group) => sum + group.commands.length, 0);
  return <div className="mx-auto w-full max-w-[832px]" data-testid="commands-settings">
    <h1 className="mb-7 text-[28px] font-bold text-(--color-foreground-strong)">{t("settings.section.commands")}</h1>
    <div className="mb-7 flex flex-wrap items-center gap-3">
      <Select pill disabled={busy} ariaLabel={label("scope")} value={target ?? "__global__"} options={[{ value: "__global__", label: label("global"), icon: <Monitor size={15} /> }, ...spaces.map((s) => ({ value: s.root, label: s.name, icon: <Folder size={15} /> }))]} onChange={(value) => { setTarget(value === "__global__" ? null : value); setDeleting(null); }} />
      <span className="border-l border-(--color-border) pl-3">{t("settings.section.commands")} <span className="text-(--color-muted)">{total}</span></span>
      <label className="ml-auto flex h-9 w-64 items-center gap-2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) px-3 focus-within:border-(--color-accent)"><Search size={15} className="text-(--color-muted)" /><input type="search" aria-label={label("search")} placeholder={label("search")} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--color-faint)" /></label>
    </div>
    <div className="mb-4 flex items-center justify-between"><h2>{label("installed")} <span className="text-(--color-muted)">{rows.length}</span></h2><div className="flex gap-2">
      <Dropdown.Root><Dropdown.Trigger disabled={!api || busy} aria-label={label("more")} className={commandButton}><MoreHorizontal size={15} /></Dropdown.Trigger><Dropdown.Portal><Dropdown.Content align="end" sideOffset={6} className="dropdown-in z-50 min-w-32 rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1 shadow-(--shadow-pop)"><Dropdown.Item onSelect={() => setDialog("import")} className="rounded-lg px-3 py-2 outline-none data-highlighted:bg-(--color-hover)">{label("import")}</Dropdown.Item></Dropdown.Content></Dropdown.Portal></Dropdown.Root>
      <button disabled={!api || loading || busy} className={commandButton} aria-label={label("refresh")} onClick={() => setTick((n) => n + 1)}><RefreshCw size={15} /></button>
      <button disabled={!api || busy} onClick={() => setDialog("create")} className="flex items-center gap-1 rounded-lg bg-(--color-brand) px-3 py-1 text-(--color-inverse) disabled:opacity-45"><Plus size={15} />{label("create")}</button>
    </div>
    </div>
    {error && <p role="alert" className="mb-4 text-(--color-tool-err)">{error}</p>}
    {visible.length > 0 && <ul aria-busy={loading || busy} className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">{visible.map((row) => <li key={row.id} className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-pop) bg-(--color-background)"><SquareSlash size={18} strokeWidth={1.4} className="text-(--color-muted)" /></span>
      <div className="min-w-0 flex-1"><p className="truncate font-mono text-(--color-foreground-strong)">/{row.name}</p><p title={row.description} className="mt-1 truncate text-[12px] text-(--color-muted)">{row.description}</p></div>
      {deleting === row.id ? <div className="flex gap-2"><button disabled={busy} className={commandButton} onClick={() => void mutate(() => api!.commandSettingsRemove(target, row.id))}>{label("confirm")}</button><button disabled={busy} className={commandButton} onClick={() => setDeleting(null)}>{label("cancel")}</button></div> : <button disabled={busy} aria-label={`${label("delete")} ${row.name}`} className="rounded p-1 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent)" onClick={() => setDeleting(row.id)}><Trash2 size={14} /></button>}
    </li>)}</ul>}
    {!visible.length && api && !loading && rows.length === 0 && !needle
      ? <div className="rounded-(--radius-pop) border border-dashed border-(--color-border) px-4 py-12 text-center">
        <p className="text-(--color-foreground-strong)">{label("empty")}</p>
        <p className="mt-1 text-[12px] text-(--color-muted)">{label("emptyHint")}</p>
        <button disabled={busy} onClick={() => setDialog("create")} className="mx-auto mt-4 flex items-center gap-1 rounded-lg bg-(--color-brand) px-3 py-1.5 text-(--color-inverse) disabled:opacity-45"><Plus size={15} />{label("create")}</button>
      </div>
      : !visible.length && <p role="status" className="py-12 text-center text-(--color-muted)">{label(!api ? "unavailable" : loading ? "loading" : "noMatch")}</p>}
    {visibleGroups.map((group) => <section key={group.id} className="mt-7" aria-label={groupTitle(group, t)}>
      <h2 className="mb-4">{groupTitle(group, t)} <span className="text-(--color-muted)">{group.commands.length}</span></h2>
      <ul className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">{group.commands.map((command) => <li key={command.name} className="flex items-center gap-3 px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-pop) bg-(--color-background)"><SquareSlash size={18} strokeWidth={1.4} className="text-(--color-muted)" /></span>
        <div className="min-w-0 flex-1"><p className="truncate font-mono text-(--color-foreground-strong)">/{command.name}</p><p title={command.description} className="mt-1 truncate text-[12px] text-(--color-muted)">{command.description}</p></div>
      </li>)}</ul>
    </section>)}
    <p className="mt-4 text-[12px] text-(--color-muted)">{label("hint")}</p>
    {dialog === "import" && api && <CommandImportDialog api={api} target={target} spaces={spaces} label={label} onClose={() => { setDialog(null); setTick((n) => n + 1); }} />}
    {dialog === "create" && api && <CommandCreateDialog label={label} onSubmit={async (input) => { await api.commandSettingsCreate(target, input); setTick((n) => n + 1); }} onClose={() => setDialog(null)} />}
  </div>;
}

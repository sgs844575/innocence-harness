import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, RefreshCw, Search, Store } from "lucide-react";
import type { PluginCatalogApi, PluginSettingsSnapshot, RepositorySource } from "../../../../../shared/pluginCatalogIpc";
import { Select } from "../../ui/Select";
import { InstallDialog } from "./InstallDialog";
import { PluginRow } from "./PluginRow";
import { actionClass, primaryClass, type Translate } from "./styles";
import { pluginPresentation } from "./pluginPresentation";

type Tab = "installed" | "discover" | "markets";
const DISCOVER_PAGE_SIZE = 24;
const SYNC_POLL_MS = 2000;
export function PluginsPanel({ api, t }: { api?: PluginCatalogApi; t: Translate }): React.JSX.Element {
  const label = (key: string) => t(`settings.plugins.${key}`);
  const [tab, setTab] = useState<Tab>("installed");
  const [snapshot, setSnapshot] = useState<PluginSettingsSnapshot>({ installed: [], markets: [], inventory: [] });
  const [query, setQuery] = useState("");
  const [marketId, setMarketId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState(DISCOVER_PAGE_SIZE);
  const [notice, setNotice] = useState(false);
  const [dialog, setDialog] = useState<{ market: boolean; source?: RepositorySource } | null>(null);
  const lock = useRef(false);
  const bootstrapped = useRef(false);
  const forceNext = useRef(false);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!api) { bootstrapped.current = true; setLoading(false); return () => { current = false; }; }
    if (!bootstrapped.current) setLoading(true);
    const force = forceNext.current;
    forceNext.current = false;
    void api.pluginCatalogSnapshot(force).then((next) => {
      if (!current) return;
      setSnapshot(next); setError("");
      // Market syncs run in the host background; poll until the settled snapshot stops flagging them.
      if (next.markets.some((row) => row.syncing)) timer = setTimeout(() => { if (current) setTick((count) => count + 1); }, SYNC_POLL_MS);
    }).catch((cause) => { if (current) setError(String(cause)); })
      .finally(() => { if (current) { bootstrapped.current = true; setLoading(false); } });
    return () => { current = false; if (timer) clearTimeout(timer); };
  }, [api, tick]);
  const refresh = (force = false) => { forceNext.current = forceNext.current || force; setTick((count) => count + 1); };
  useEffect(() => { setShown(DISCOVER_PAGE_SIZE); }, [query, marketId]);
  const mutate = async (action: () => Promise<void>, changesRuntime = false) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); if (changesRuntime) setNotice(true); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  };
  const disabled = !api || busy || loading;
  const needle = query.trim().toLocaleLowerCase();
  const matches = (...parts: (string | undefined)[]) => parts.join(" ").toLocaleLowerCase().includes(needle);
  const installedById = useMemo(() => new Map(snapshot.installed.map((row) => [row.id, row])), [snapshot.installed]);
  const rank = (id: string, core: boolean) => installedById.has(id) ? 0 : core ? 2 : 1;
  const rows = useMemo(() => [...snapshot.inventory, ...snapshot.installed.filter((row) => !snapshot.inventory.some((item) => item.id === row.id)).map((row) => ({ id: row.id, title: row.title, core: false, client: false, toggleable: false, state: "config-invalid" as const, via: "default" as const }))]
    .sort((a, b) => rank(a.id, a.core) - rank(b.id, b.core))
    .filter((row) => { const display = pluginPresentation(row, installedById.get(row.id), t); return matches(row.id, display.title, display.description); }),
    [snapshot, installedById, needle, t]);
  const markets = useMemo(() => snapshot.markets.filter((row) => matches(row.title, row.source.url)), [snapshot.markets, needle]);
  const entries = useMemo(() => snapshot.markets.filter((row) => marketId === "all" || row.id === marketId)
    .flatMap((market) => market.entries.map((entry) => ({ market, entry })))
    .filter(({ entry, market }) => matches(entry.name, entry.description, entry.category, market.title)),
    [snapshot.markets, marketId, needle]);
  const pendingSync = useMemo(() => snapshot.markets.filter((row) => row.syncing), [snapshot.markets]);
  const visibleEntries = entries.slice(0, shown);
  return <div data-testid="plugin-settings" className="mx-auto w-full max-w-[832px]">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><h1 className="text-[28px] font-bold text-(--color-foreground-strong)">{t("settings.section.plugins")}</h1><button className={primaryClass} disabled={disabled} onClick={() => setDialog({ market: false })}><Download size={15} />{label("fromGit")}</button></div>
    <p className="mb-7 text-(--color-muted)">{label("subtitle")}</p>
    <div className="mb-5 flex gap-5 border-b border-(--color-border)">{(["installed", "discover", "markets"] as const).map((id) => <button key={id} aria-pressed={tab === id} disabled={busy} onClick={() => { setTab(id); setQuery(""); }} className={`border-b-2 px-1 pb-3 focus-visible:outline-2 focus-visible:outline-(--color-accent) ${tab === id ? "border-(--color-foreground-strong) text-(--color-foreground-strong)" : "border-transparent text-(--color-muted) hover:text-(--color-foreground)"}`}>{label(id)}{id !== "discover" && <span className="ml-2 text-[12px] text-(--color-faint)">{id === "installed" ? snapshot.inventory.length : snapshot.markets.length}</span>}</button>)}</div>
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <label className="flex h-9 min-w-48 flex-1 items-center gap-2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) px-3 focus-within:border-(--color-accent)"><Search size={15} className="text-(--color-muted)" /><input type="search" aria-label={label("search")} placeholder={label("search")} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--color-faint)" /></label>
      {tab === "discover" && <Select value={marketId} ariaLabel={label("marketFilter")} options={[{ value: "all", label: label("allMarkets") }, ...snapshot.markets.map((row) => ({ value: row.id, label: row.title }))]} onChange={setMarketId} />}
      <button className={actionClass} disabled={disabled} aria-label={label("refresh")} onClick={() => refresh(true)}><RefreshCw size={15} /></button>
      {tab === "markets" && <button className={actionClass} disabled={disabled} onClick={() => setDialog({ market: true })}><Plus size={15} />{label("addMarket")}</button>}
    </div>
    {notice && <p role="status" className="mb-4 rounded-lg bg-(--color-selected) px-3 py-2 text-(--color-muted)">{label("applyHint")}</p>}
    {error && <p role="alert" className="mb-4 break-words text-(--color-tool-err)">{error}</p>}
    {tab !== "installed" && pendingSync.length > 0 && <p role="status" className="mb-4 text-(--color-muted)">{label("syncingMarkets")}</p>}
    {tab !== "installed" && snapshot.markets.filter((market) => market.syncError).map((market) => <div key={market.id} role="alert" className="mb-4 flex items-start gap-3 rounded-(--radius-pop) bg-(--color-selected) p-3"><p className="min-w-0 flex-1 break-words text-(--color-tool-warn)">{market.title} · {label("syncFailed")}<br />{market.syncError}</p><button className={actionClass} disabled={disabled} onClick={() => void mutate(() => api!.pluginMarketRefresh(market.id))}>{label("sync")}</button></div>)}
    {busy && <p role="status" className="mb-4 text-(--color-muted)">{label("working")}</p>}
    {tab === "installed" && <ul aria-busy={loading || busy} className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">{rows.map((entry) => <PluginRow key={entry.id} entry={entry} installed={installedById.get(entry.id)} t={t} busy={disabled} onToggle={(enabled) => void mutate(() => api!.pluginSetEnabled(entry.id, enabled), true)} onUpdate={(source) => setDialog({ market: false, source })} onRemove={() => void mutate(() => api!.pluginUninstall(entry.id), true)} />)}</ul>}
    {tab === "discover" && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{visibleEntries.map(({ entry, market }) => <article key={`${market.id}/${entry.name}`} className="flex flex-col rounded-(--radius-pop) border border-(--color-hairline) bg-(--color-panel) p-4">
      <h2 className="font-medium text-(--color-foreground-strong)">{entry.name}</h2><p className="mt-1 text-[12px] text-(--color-faint)">{market.title}{entry.category ? ` · ${entry.category}` : ""}</p><p className="mt-3 flex-1 text-(--color-muted)">{entry.description || label("noDescription")}</p>
      {entry.unavailable && <p className="mt-3 text-[12px] text-(--color-tool-warn)">{entry.unavailable}</p>}
      <div className="mt-4 flex items-center justify-between gap-2"><span className="text-[12px] text-(--color-faint)">{entry.version}</span><button className={actionClass} disabled={disabled || !entry.source} onClick={() => setDialog({ market: false, source: entry.source })}>{label("viewInstall")}</button></div>
    </article>)}</div>}
    {tab === "discover" && entries.length > shown && <div className="mt-4 flex flex-col items-center gap-2">
      <button className={actionClass} onClick={() => setShown((count) => count + DISCOVER_PAGE_SIZE)}>{label("loadMore")}</button>
      <p className="text-[12px] text-(--color-faint)">{label("shownCount").replace("{shown}", String(shown)).replace("{total}", String(entries.length))}</p>
    </div>}
    {tab === "markets" && <ul className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">{markets.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-3 p-4"><Store size={20} strokeWidth={1.4} className="text-(--color-muted)" /><div className="min-w-0 flex-1"><h2 className="font-medium text-(--color-foreground-strong)">{row.title}</h2><p className="mt-1 break-all font-mono text-[12px] text-(--color-muted)">{row.source.url}</p><p className="mt-1 text-[12px] text-(--color-faint)">{row.entries.length} {label("pluginsCount")} · {row.syncing ? label("syncingShort") : `${label("synced")} ${row.updatedAt ? new Date(row.updatedAt).toLocaleString() : label("notSynced")}`}</p></div><button className={actionClass} disabled={disabled} aria-label={`${label("sync")} ${row.title}`} onClick={() => void mutate(() => api!.pluginMarketRefresh(row.id))}>{label("sync")}</button><button className={actionClass} disabled={disabled} aria-label={`${label("removeMarket")} ${row.title}`} onClick={() => void mutate(async () => { await api!.pluginMarketRemove(row.id); setMarketId("all"); })}>{label("removeMarket")}</button></li>)}</ul>}
    {(tab === "installed" ? !rows.length : tab === "markets" ? !markets.length : !entries.length) && <div role="status" className="py-14 text-center text-(--color-muted)"><Store size={28} strokeWidth={1.3} className="mx-auto mb-3 text-(--color-faint)" /><p>{label(!api ? "unavailable" : loading ? "loading" : pendingSync.length ? "syncingMarkets" : query ? "noResults" : tab === "installed" ? "emptyInstalled" : "emptyMarkets")}</p>{api && !loading && !pendingSync.length && tab !== "installed" && !query && <button className={`${actionClass} mt-4`} onClick={() => setDialog({ market: true })}><Plus size={15} />{label("addMarket")}</button>}</div>}
    {tab === "markets" && !!snapshot.markets.length && <p className="mt-4 text-[12px] text-(--color-muted)">{label("removeMarketHint")}</p>}
    {dialog && api && <InstallDialog api={api} t={t} {...dialog} onClose={() => setDialog(null)} onChanged={() => { if (!dialog.market) setNotice(true); refresh(); }} />}
  </div>;
}

import { useEffect, useRef, useState } from "react";
import { Cable, Plus, RefreshCw, Search, Ellipsis } from "lucide-react";
import type { McpServerEntry, McpSettingsApi } from "../../../../shared/mcpSettingsIpc";
import { Popover } from "../ui/Popover";
import { McpScope } from "./McpScope";
import { serverSummary } from "./mcpForm";
import { Switch } from "../ui/Switch";
import { McpEditor } from "./McpEditor";

const button = "rounded-lg border border-(--color-border) px-2 py-1.5 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent) disabled:opacity-45";
export function McpPanel({ api, t }: { api?: McpSettingsApi; t: (key: string) => string }): React.JSX.Element {
  const [root, setRoot] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<{ root: string; name: string }[]>([]);
  const [rows, setRows] = useState<Record<string, McpServerEntry>>({});
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const [editor, setEditor] = useState<{ name: string; entry: McpServerEntry; create: boolean; importing?: boolean } | null>(null);
  const lock = useRef(false);
  const label = (key: string) => t(`settings.mcp.${key}`);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(""); setRows({});
    if (!api) { setLoading(false); return; }
    void api.mcpSettingsWorkspaces().then(async (workspaces) => {
      const selected = root === null || workspaces.some((space) => space.root === root) ? root : null;
      const entries = await api.mcpSettingsList(selected);
      if (current) { setSpaces(workspaces); setRoot(selected); setRows(entries); }
    }).catch((cause) => { if (current) setError(String(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, root, tick]);
  const mutate = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); setTick((n) => n + 1); }
    catch (cause) { setError(String(cause)); }
    finally { lock.current = false; setBusy(false); }
  };
  const blocked = !api || loading || busy;
  const visible = Object.entries(rows).filter(([name]) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  if (editor && api) return <McpEditor {...editor} root={root} spaces={spaces} t={t} onClose={() => setEditor(null)} onDelete={editor.create ? undefined : async () => { await api.mcpSettingsSave(root, editor.name, null, false); setTick((n) => n + 1); }} onSave={async (target, servers) => {
    if (editor.create) {
      const result = await api.mcpSettingsImport(target, JSON.stringify({ mcpServers: servers }));
      if (!result.imported.length) throw new Error(result.skipped.map((row) => row.name + ": " + label(row.reason)).join(", ") || label("invalid"));
      setNotice(label("importResult").replace("{count}", String(result.imported.length)).replace("{skipped}", String(result.skipped.length)));
    } else await api.mcpSettingsSave(target, editor.name, servers[editor.name], false);
    setRoot(target); setTick((n) => n + 1);
  }} />;
  return <div className="mx-auto w-full max-w-[832px]" data-testid="mcp-settings">
    <h1 className="mb-8 text-[32px] font-bold text-(--color-foreground-strong)">{t("settings.section.mcp")}</h1>
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <McpScope value={root} spaces={spaces} disabled={busy || loading} onChange={(value) => { setRoot(value); setNotice(""); }} t={t} />
      <span className="border-l border-(--color-border) pl-6 text-(--color-muted)">MCP <span className="text-[12px]">{Object.keys(rows).length}</span></span>
      <label className="ml-auto flex h-9 w-64 max-w-full items-center gap-2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) px-3 focus-within:border-(--color-accent)"><Search size={15} strokeWidth={1.4} className="text-(--color-muted)" /><input type="search" aria-label={label("search")} placeholder={label("search")} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--color-faint)" /></label>
    </div>
    <div className="mb-4 flex items-center justify-between"><h2>{label("installed")} <span className="text-[12px] text-(--color-muted)">{Object.keys(rows).length}</span></h2><div className="flex items-center gap-2">
      <Popover open={menu} onOpenChange={setMenu} side="bottom" align="end" contentClassName="p-1" trigger={<button className={button} disabled={blocked} aria-label={label("more")}><Ellipsis size={15} /></button>}><button className="rounded-lg px-3 py-2 hover:bg-(--color-hover)" onClick={() => { setMenu(false); setEditor({ name: "", entry: { type: "stdio", command: "", args: [] }, create: true, importing: true }); }}>{label("import")}</button></Popover>
      <button className={button} disabled={!api || busy || loading} aria-label={label("refresh")} onClick={() => setTick((n) => n + 1)}><RefreshCw size={15} /></button>
      <button className="flex items-center gap-1 rounded-lg bg-(--color-brand) px-2 py-1 text-(--color-inverse) disabled:opacity-45" disabled={blocked} onClick={() => setEditor({ name: "", entry: { type: "stdio", command: "", args: [] }, create: true })}><Plus size={15} />{label("create")}</button>
    </div></div>
    {error && <p role="alert" className="mb-4 text-(--color-tool-err)">{error}</p>}
    {notice && <p role="status" className="mb-4 text-(--color-muted)">{notice}</p>}
    <ul aria-busy={loading || busy} className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">
      {visible.map(([name, entry]) => <li key={name} className="flex min-h-[68px] items-center gap-3 px-4 py-3">
        <span className="relative grid size-9 shrink-0 place-items-center rounded-(--radius-pop) bg-(--color-background)"><Cable size={18} strokeWidth={1.4} className="text-(--color-muted)" /><span title={label(entry?.disabled ? "disabled" : "enabled")} className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-(--color-panel) bg-(--color-faint)" /></span>
        <button disabled={busy} aria-label={name} className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-(--color-accent)" onClick={() => setEditor({ name, entry, create: false })}><span className="font-medium text-(--color-foreground-strong)">{name}</span><p className="mt-1 truncate text-[12px] text-(--color-muted)">{serverSummary(entry)}</p></button>
        <Switch tone="neutral" disabled={blocked || !entry || typeof entry !== "object"} checked={!entry?.disabled} label={label("enabled") + " " + name} onChange={(enabled) => void mutate(() => api!.mcpSettingsSave(root, name, { ...entry, disabled: !enabled }, false))} />
      </li>)}
    </ul>
    {!visible.length && <p role="status" className="py-12 text-center text-(--color-muted)">{label(!api ? "unavailable" : loading ? "loading" : "empty")}</p>}
    <p className="mt-5 text-[12px] text-(--color-faint)">{label("hint")}</p>
  </div>;
}

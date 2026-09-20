import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { RefreshCw, X } from "lucide-react";
import { Select } from "../ui/Select";
import type { DiscoveredCommandMirror } from "../../../../shared/commandSettingsIpc";
import type { CommandsApi } from "./CommandsPanel";

const fieldClass = "w-full rounded-lg border border-(--color-border) bg-(--color-background) px-3 py-2 text-(--color-foreground) outline-none focus:border-(--color-accent) disabled:opacity-60";
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function Frame({ title, description, close, busy, closeLabel, children }: { title: string; description: string; close: () => void; busy: boolean; closeLabel: string; children: ReactNode }): React.JSX.Element {
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) close(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-(--color-markdown-table-backdrop)" /><Dialog.Content className="modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(672px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)"><div className="flex items-center justify-between"><Dialog.Title className="font-medium">{title}</Dialog.Title><Dialog.Close disabled={busy} aria-label={closeLabel} className="rounded p-1 hover:bg-(--color-hover)"><X size={16} /></Dialog.Close></div><Dialog.Description className="mt-2 text-[12px] text-(--color-muted)">{description}</Dialog.Description>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function CommandCreateDialog({ label, onSubmit, onClose }: { label: (key: string) => string; onSubmit: (input: { id: string; description: string; body: string }) => Promise<void>; onClose: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState({ id: "", description: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    const id = draft.id.trim();
    if (!NAME_PATTERN.test(id)) { setError(label("invalidName")); return; }
    lock.current = true; setBusy(true); setError("");
    try { await onSubmit({ id, description: draft.description.trim(), body: draft.body }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Frame title={label("createTitle")} description={label("createHint")} busy={busy} close={onClose} closeLabel={label("close")}>
    <form className="scrollbar-thin mt-4 space-y-4 overflow-y-auto" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="block space-y-1"><span className="text-(--color-muted)">{label("fieldName")}</span><input required maxLength={64} pattern="[a-z0-9][a-z0-9-]*" disabled={busy} className={`${fieldClass} font-mono`} value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} /></label>
      <label className="block space-y-1"><span className="text-(--color-muted)">{label("fieldDescription")}</span><input required maxLength={1000} disabled={busy} className={fieldClass} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="block space-y-1"><span className="text-(--color-muted)">{label("fieldBody")}</span><textarea required rows={8} maxLength={100000} spellCheck={false} disabled={busy} className={`${fieldClass} font-mono text-[13px]`} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
      {error && <p role="alert" className="text-(--color-tool-err)">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-2 hover:bg-(--color-hover)">{label("cancel")}</button><button type="submit" disabled={busy} className="rounded-lg bg-(--color-brand) px-4 py-2 text-(--color-inverse) disabled:opacity-45">{label(busy ? "loading" : "submit")}</button></div>
    </form>
  </Frame>;
}

export function CommandImportDialog({ api, target: initialTarget, spaces, label, onClose }: { api: CommandsApi; target: string | null; spaces: { root: string; name: string }[]; label: (key: string) => string; onClose: () => void }): React.JSX.Element {
  const [target, setTarget] = useState(initialTarget);
  const [rows, setRows] = useState<DiscoveredCommandMirror[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    let current = true; setLoading(true); setRows([]); setSelected([]); setError("");
    void api.commandSettingsDiscover(target).then((data) => { if (current) setRows(data); }).catch((e) => { if (current) setError(String(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, target, tick]);
  const available = rows.filter((c) => !c.imported);
  return <Frame title={label("importTitle")} description={label("copyHint")} busy={busy} close={onClose} closeLabel={label("close")}>
    <div className="mt-4 flex justify-end"><Select ariaLabel={label("importScope")} disabled={busy} value={target ?? "__global__"} options={[{ value: "__global__", label: label("global") }, ...spaces.map((space) => ({ value: space.root, label: space.name }))]} onChange={(value) => { const next = value === "__global__" ? null : value; if (next === target) return; setRows([]); setSelected([]); setLoading(true); setTarget(next); }} /></div>
    <div className="mt-4 flex items-center gap-2"><label className="flex items-center gap-2"><input type="checkbox" disabled={busy || loading || !available.length} checked={available.length > 0 && selected.length === available.length} onChange={(e) => setSelected(e.target.checked ? available.map((c) => c.sourceFile) : [])} />{label("all")}</label><span className="ml-auto text-(--color-muted)">{selected.length}/{available.length}</span><button aria-label={label("refresh")} disabled={busy || loading} className="rounded p-1 hover:bg-(--color-hover)" onClick={() => setTick((n) => n + 1)}><RefreshCw size={15} /></button></div>
    <div className="scrollbar-thin mt-3 min-h-0 max-h-[50vh] overflow-y-auto rounded-(--radius-pop) border border-(--color-border) p-3">
      {[...new Set(rows.map((c) => c.origin))].map((origin) => <details key={origin} open className="mb-3"><summary className="py-2 text-(--color-muted)">{origin} · {rows.filter((c) => c.origin === origin).length}</summary>{rows.filter((c) => c.origin === origin).map((c) => <label key={c.sourceFile} className="flex items-center gap-3 rounded-lg p-2 hover:bg-(--color-hover)"><input type="checkbox" disabled={busy || loading || c.imported} checked={selected.includes(c.sourceFile)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, c.sourceFile] : old.filter((v) => v !== c.sourceFile))} /><span className="min-w-0"><span>/{c.name}{c.imported && ` · ${label("installed")}`}</span><span className="block truncate font-mono text-[12px] text-(--color-faint)" title={c.sourceFile}>{c.sourceFile}</span></span></label>)}</details>)}
      {!rows.length && <p role="status" className="py-8 text-center text-(--color-muted)">{label(loading ? "loading" : "noImport")}</p>}
    </div>
    {error && <p role="alert" className="mt-3 text-(--color-tool-err)">{error}</p>}
    <div className="mt-4 flex justify-end"><button disabled={busy || loading || !selected.length} className="rounded-lg bg-(--color-brand) px-4 py-2 text-(--color-inverse) disabled:opacity-45" onClick={() => {
      if (lock.current) return;
      lock.current = true; setBusy(true); setError("");
      void (async () => { for (const sourceFile of selected) { await api.commandSettingsImport(target, sourceFile); setRows((old) => old.map((c) => c.sourceFile === sourceFile ? { ...c, imported: true } : c)); setSelected((old) => old.filter((v) => v !== sourceFile)); } onClose(); })().catch((e) => setError(String(e))).finally(() => { lock.current = false; setBusy(false); });
    }}>{label(busy ? "loading" : "import")}</button></div>
  </Frame>;
}

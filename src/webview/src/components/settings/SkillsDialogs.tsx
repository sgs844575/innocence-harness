import { Select } from "../ui/Select";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { RefreshCw, X } from "lucide-react";
import type { DiscoveredSkillMirror } from "../../../../shared/ipc";
import type { SkillsApi } from "./SkillsPanel";

function Frame({ title, description, close, busy, children }: { title: string; description: string; close: () => void; busy: boolean; children: ReactNode }): React.JSX.Element {
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) close(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-(--color-markdown-table-backdrop)" /><Dialog.Content className="modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(672px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)"><div className="flex items-center justify-between"><Dialog.Title className="font-medium">{title}</Dialog.Title><Dialog.Close disabled={busy} aria-label="Close" className="rounded p-1 hover:bg-(--color-hover)"><X size={16} /></Dialog.Close></div><Dialog.Description className="mt-2 text-[12px] text-(--color-muted)">{description}</Dialog.Description>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function SkillImportDialog({ api, target: initialTarget, spaces, label, onClose }: { api: SkillsApi; target: string | null; spaces: { root: string; name: string }[]; label: (key: string) => string; onClose: () => void }): React.JSX.Element {
  const [target, setTarget] = useState(initialTarget);
  const [rows, setRows] = useState<DiscoveredSkillMirror[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    let current = true; setLoading(true); setRows([]); setSelected([]); setError("");
    void api.skillSettingsDiscover(target).then((data) => { if (current) setRows(data); }).catch((e) => { if (current) setError(String(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, target, tick]);
  const available = rows.filter((s) => !s.imported);
  return <Frame title={label("importTitle")} description={label("copyHint")} busy={busy} close={onClose}>
    <div className="mt-4 flex justify-end"><Select ariaLabel={label("importScope")} disabled={busy} value={target ?? "__global__"} options={[{ value: "__global__", label: label("global") }, ...spaces.map((space) => ({ value: space.root, label: space.name }))]} onChange={(value) => { const next = value === "__global__" ? null : value; if (next === target) return; setRows([]); setSelected([]); setLoading(true); setTarget(next); }} /></div>
    <div className="mt-4 flex items-center gap-2"><label className="flex items-center gap-2"><input type="checkbox" disabled={busy || loading || !available.length} checked={available.length > 0 && selected.length === available.length} onChange={(e) => setSelected(e.target.checked ? available.map((s) => s.sourceDir) : [])} />{label("all")}</label><span className="ml-auto text-(--color-muted)">{selected.length}/{available.length}</span><button aria-label={label("refresh")} disabled={busy || loading} className="rounded p-1 hover:bg-(--color-hover)" onClick={() => setTick((n) => n + 1)}><RefreshCw size={15} /></button></div>
    <div className="scrollbar-thin mt-3 min-h-0 max-h-[50vh] overflow-y-auto rounded-(--radius-pop) border border-(--color-border) p-3">
      {[...new Set(rows.map((s) => s.origin))].map((origin) => <details key={origin} open className="mb-3"><summary className="py-2 text-(--color-muted)">{origin} · {rows.filter((s) => s.origin === origin).length}</summary>{rows.filter((s) => s.origin === origin).map((s) => <label key={s.sourceDir} className="flex items-center gap-3 rounded-lg p-2 hover:bg-(--color-hover)"><input type="checkbox" disabled={busy || loading || s.imported} checked={selected.includes(s.sourceDir)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, s.sourceDir] : old.filter((v) => v !== s.sourceDir))} /><span className="min-w-0"><span>{s.name}{s.imported && ` · ${label("installed")}`}</span><span className="block truncate font-mono text-[12px] text-(--color-faint)" title={s.sourceDir}>{s.sourceDir}</span></span></label>)}</details>)}
      {!rows.length && <p role="status" className="py-8 text-center text-(--color-muted)">{label(loading ? "loading" : "noImport")}</p>}
    </div>
    {error && <p role="alert" className="mt-3 text-(--color-tool-err)">{error}</p>}
    <div className="mt-4 flex justify-end"><button disabled={busy || loading || !selected.length} className="rounded-lg bg-(--color-brand) px-4 py-2 text-(--color-inverse) disabled:opacity-45" onClick={() => {
      if (lock.current) return;
      lock.current = true; setBusy(true); setError("");
      void (async () => { for (const source of selected) { await api.skillSettingsImport(target, source); setRows((old) => old.map((s) => s.sourceDir === source ? { ...s, imported: true } : s)); setSelected((old) => old.filter((v) => v !== source)); } onClose(); })().catch((e) => setError(String(e))).finally(() => { lock.current = false; setBusy(false); });
    }}>{label(busy ? "loading" : "import")}</button></div>
  </Frame>;
}

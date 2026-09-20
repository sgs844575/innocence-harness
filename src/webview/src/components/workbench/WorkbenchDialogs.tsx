import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

const fieldClass = "w-full rounded-lg border border-(--color-border) bg-(--color-background) px-3 py-2 text-(--color-foreground) outline-none focus:border-(--color-accent) disabled:opacity-60";

export function WorkbenchCreateDialog({ label, onSubmit, onClose }: { label: (key: string) => string; onSubmit: (name: string, description: string) => Promise<void>; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    if (!name.trim()) { setError(label("invalidName")); return; }
    lock.current = true; setBusy(true); setError("");
    try { await onSubmit(name.trim(), description.trim()); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-(--color-markdown-table-backdrop)" /><Dialog.Content className="modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(672px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)"><div className="flex items-center justify-between"><Dialog.Title className="font-medium">{label("createTitle")}</Dialog.Title><Dialog.Close disabled={busy} aria-label={label("close")} className="rounded p-1 hover:bg-(--color-hover)"><X size={16} /></Dialog.Close></div><Dialog.Description className="mt-2 text-[12px] text-(--color-muted)">{label("createHint")}</Dialog.Description>
    <form className="scrollbar-thin mt-4 space-y-4 overflow-y-auto" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="block space-y-1"><span className="text-(--color-muted)">{label("fieldName")}</span><input required maxLength={120} disabled={busy} className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block space-y-1"><span className="text-(--color-muted)">{label("fieldDesc")}</span><textarea rows={5} maxLength={20000} spellCheck={false} disabled={busy} placeholder={label("descPlaceholder")} className={`${fieldClass} placeholder:text-(--color-faint)`} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      {error && <p role="alert" className="text-(--color-tool-err)">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-2 hover:bg-(--color-hover)">{label("cancel")}</button><button type="submit" disabled={busy} className="rounded-lg bg-(--color-brand) px-4 py-2 text-(--color-inverse) disabled:opacity-45">{label(busy ? "loading" : "submit")}</button></div>
    </form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

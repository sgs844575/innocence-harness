import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { SavedPreset } from "../../../../shared/subagentIpc";
import { Select } from "../ui/Select";

const fieldClass = "w-full rounded-lg border border-(--color-border) bg-(--color-background) px-3 py-2 text-(--color-foreground) outline-none focus:border-(--color-accent) disabled:opacity-60";
export function SubagentEditor({ preset, create, readOnly, t, onSave, onClose }: {
  preset: SavedPreset; create: boolean; readOnly: boolean; t: (key: string) => string;
  onSave: (preset: SavedPreset) => Promise<void>; onClose: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(preset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const label = (key: string) => t(`settings.subagents.${key}`);
  const save = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await onSave(draft); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-(--color-markdown-table-backdrop)" />
    <Dialog.Content className="modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)">
      <div className="flex items-center justify-between"><Dialog.Title className="font-semibold text-(--color-foreground-strong)">{label(readOnly ? "view" : create ? "create" : "edit")}</Dialog.Title><Dialog.Close disabled={busy} aria-label={label("close")} className="rounded-md p-1 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent)"><X size={16} /></Dialog.Close></div>
      <Dialog.Description className="mt-2 text-(--color-muted)">{label(readOnly ? "readonly" : "promptHint")}</Dialog.Description>
      <form className="scrollbar-thin mt-4 space-y-4 overflow-y-auto" onSubmit={(event) => { event.preventDefault(); if (!readOnly) void save(); }}>
        {(["id", "title", "description"] as const).map((key) => <label key={key} className="block space-y-1"><span>{label(key)}</span><input required maxLength={key === "id" ? 64 : 1000} pattern={key === "id" ? "[a-z][a-z0-9-]{0,63}" : undefined} className={fieldClass} disabled={busy || readOnly || (key === "id" && !create)} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
        <label className="block space-y-1"><span>{label("tools")}</span><Select fullWidth disabled={busy || readOnly} ariaLabel={label("tools")} value={draft.tools} options={[{ value: "all", label: label("all") }, { value: "readOnly", label: label("readOnly") }]} onChange={(tools) => setDraft({ ...draft, tools: tools as SavedPreset["tools"] })} /></label>
        <label className="block space-y-1"><span>{label("systemPrompt")}</span><textarea required readOnly={readOnly} disabled={busy} rows={10} maxLength={100000} spellCheck={false} className={`${fieldClass} font-mono text-[13px]`} value={draft.systemPrompt} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} /></label>
        {error && <p role="alert" className="text-(--color-tool-err)">{error}</p>}
        {!readOnly && <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-2 hover:bg-(--color-hover)">{label("cancel")}</button><button type="submit" disabled={busy} className="rounded-lg bg-(--color-brand) px-4 py-2 text-(--color-inverse) disabled:opacity-45">{label(busy ? "saving" : "save")}</button></div>}
      </form>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
